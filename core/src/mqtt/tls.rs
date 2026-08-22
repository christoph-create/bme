//! Builds the `rustls` client configuration a TLS connection runs on.
//!
//! rumqttc offers a ready-made `TlsConfiguration::Simple { ca, alpn,
//! client_auth }`, and this deliberately does not use it: `Simple` *replaces*
//! the system trust store with the supplied CA and errors out when that CA is
//! empty. A private CA is almost always an addition to the public roots rather
//! than a substitute for them, and "system roots, nothing else" has to stay
//! expressible - it is what every ordinary `mqtts://` connection uses. Building
//! the config here covers both, and is the only way to reach the custom
//! verifier that `skip_cert_verification` needs.

use std::fs;
use std::io::{BufReader, Cursor};
use std::sync::Arc;

// rumqttc is on rustls 0.22 while the update checker's reqwest is on 0.23, so
// both are in this tree as separate crates. Everything here has to be the
// former: a 0.23 `ClientConfig` is a different type to the one rumqttc's
// `TlsConfiguration::Rustls` accepts.
use rumqttc_rustls as rustls;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as RustlsError, RootCertStore};

use crate::models::BrokerConnection;

/// Everything that can go wrong assembling a TLS setup from what the user
/// typed. These messages are shown as-is in the connection banner, so each one
/// names the file it is talking about.
#[derive(Debug, thiserror::Error)]
pub enum TlsConfigError {
    #[error("Could not read the certificate file {path}: {source}")]
    FileUnreadable {
        path: String,
        source: std::io::Error,
    },
    #[error("No certificate found in {path}. It should be a PEM file beginning with -----BEGIN CERTIFICATE-----.")]
    NoCertificates { path: String },
    #[error("No private key found in {path}. It should be a PEM file containing an RSA, EC or PKCS#8 private key.")]
    NoPrivateKey { path: String },
    #[error("A client certificate was given without its private key. Mutual TLS needs both.")]
    ClientCertWithoutKey,
    #[error("A client private key was given without its certificate. Mutual TLS needs both.")]
    ClientKeyWithoutCert,
    #[error("Could not load the system certificate store: {0}")]
    SystemRoots(std::io::Error),
    #[error("TLS configuration rejected: {0}")]
    Rustls(#[from] RustlsError),
}

/// The TLS setup for `broker`, ready to hand to rumqttc.
pub fn client_config(broker: &BrokerConnection) -> Result<Arc<ClientConfig>, TlsConfigError> {
    let builder = if broker.skip_cert_verification {
        // The root store is skipped entirely rather than built and ignored:
        // with no verification happening, a missing or unreadable CA file is
        // not an error worth failing the connection over.
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertVerification::ring()))
    } else {
        ClientConfig::builder().with_root_certificates(root_store(broker)?)
    };

    let mut config = match (&broker.client_cert_path, &broker.client_key_path) {
        (Some(cert_path), Some(key_path)) => {
            let certs = read_certificates(cert_path)?;
            let key = read_private_key(key_path)?;
            builder.with_client_auth_cert(certs, key)?
        }
        (None, None) => builder.with_no_client_auth(),
        (Some(_), None) => return Err(TlsConfigError::ClientCertWithoutKey),
        (None, Some(_)) => return Err(TlsConfigError::ClientKeyWithoutCert),
    };

    config.alpn_protocols = alpn_protocols(broker.alpn.as_deref());

    Ok(Arc::new(config))
}

/// The system trust store, plus the user's own CA when they named one. Adding
/// rather than replacing matters for brokers that present a chain from a public
/// CA on one listener and a private one on another, and for anyone who expects
/// a normal broker to keep working after they attach a cert for a second.
fn root_store(broker: &BrokerConnection) -> Result<RootCertStore, TlsConfigError> {
    let mut roots = RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().map_err(TlsConfigError::SystemRoots)? {
        // Ignoring individual failures on purpose: a system store with one
        // unparseable certificate in it is common and is not a reason to
        // refuse to connect.
        let _ = roots.add(cert);
    }

    if let Some(path) = non_empty(broker.ca_cert_path.as_deref()) {
        let certs = read_certificates(path)?;
        let (_, ignored) = roots.add_parsable_certificates(certs);
        if ignored > 0 {
            log::warn!("{ignored} certificate(s) in {path} could not be parsed and were ignored");
        }
    }

    Ok(roots)
}

fn read_certificates(path: &str) -> Result<Vec<CertificateDer<'static>>, TlsConfigError> {
    let pem = read_file(path)?;
    let certs = rustls_pemfile::certs(&mut BufReader::new(Cursor::new(pem)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|source| TlsConfigError::FileUnreadable {
            path: path.to_string(),
            source,
        })?;

    if certs.is_empty() {
        return Err(TlsConfigError::NoCertificates {
            path: path.to_string(),
        });
    }
    Ok(certs)
}

/// Reads the first private key in the file, whichever of the three PEM
/// spellings it uses. Keys are handed out in all of them depending on which
/// tool generated them, and which one you got is not something a user should
/// have to know.
fn read_private_key(path: &str) -> Result<PrivateKeyDer<'static>, TlsConfigError> {
    let pem = read_file(path)?;
    let mut reader = BufReader::new(Cursor::new(pem));

    loop {
        let item = rustls_pemfile::read_one(&mut reader).map_err(|source| {
            TlsConfigError::FileUnreadable {
                path: path.to_string(),
                source,
            }
        })?;

        match item {
            Some(rustls_pemfile::Item::Pkcs1Key(key)) => return Ok(key.into()),
            Some(rustls_pemfile::Item::Pkcs8Key(key)) => return Ok(key.into()),
            Some(rustls_pemfile::Item::Sec1Key(key)) => return Ok(key.into()),
            // Certificates alongside the key are normal - combined PEM bundles
            // exist - so keep reading rather than giving up on the first one.
            Some(_) => continue,
            None => {
                return Err(TlsConfigError::NoPrivateKey {
                    path: path.to_string(),
                })
            }
        }
    }
}

fn read_file(path: &str) -> Result<Vec<u8>, TlsConfigError> {
    fs::read(path).map_err(|source| TlsConfigError::FileUnreadable {
        path: path.to_string(),
        source,
    })
}

/// Splits the stored comma-separated list. AWS IoT wants a single
/// `x-amzn-mqtt-ca`, but the field takes a list so a second protocol never
/// needs a migration.
fn alpn_protocols(alpn: Option<&str>) -> Vec<Vec<u8>> {
    alpn.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|protocol| !protocol.is_empty())
        .map(|protocol| protocol.as_bytes().to_vec())
        .collect()
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Accepts every server certificate.
///
/// This is what `skip_cert_verification` buys: no chain is checked, no hostname
/// is matched, and anything on the wire that can complete a handshake is
/// trusted. It exists because a self-signed broker is otherwise unreachable and
/// people give up rather than build a CA - but it makes the connection
/// interceptable by anyone on the path, which is why the UI marks it the way it
/// does.
///
/// The handshake *signature* checks are still delegated to rustls: they prove
/// the peer holds the key in the certificate it just presented, which costs
/// nothing to keep and stops the connection succeeding against a peer that is
/// not even self-consistent.
#[derive(Debug)]
struct NoCertVerification {
    supported: WebPkiSupportedAlgorithms,
}

impl NoCertVerification {
    fn ring() -> Self {
        Self {
            supported: rustls::crypto::ring::default_provider().signature_verification_algorithms,
        }
    }
}

impl ServerCertVerifier for NoCertVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls12_signature(message, cert, dss, &self.supported)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls13_signature(message, cert, dss, &self.supported)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.supported.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::BrokerScheme;
    use std::io::Write;
    use uuid::Uuid;

    fn broker() -> BrokerConnection {
        BrokerConnection {
            id: Uuid::new_v4(),
            name: "Test".to_string(),
            host: "localhost".to_string(),
            port: 8883,
            client_id: "bme-test".to_string(),
            username: None,
            password: None,
            scheme: BrokerScheme::Mqtts,
            ws_path: None,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            alpn: None,
            skip_cert_verification: false,
            keep_alive_secs: 60,
            auto_reconnect: false,
            max_reconnect_attempts: 0,
            subscriptions: Vec::new(),
        }
    }

    /// A throwaway file that cleans itself up, so the tests need no dev
    /// dependency for it.
    struct TempFile(std::path::PathBuf);

    impl TempFile {
        fn with(contents: &str) -> Self {
            let path = std::env::temp_dir().join(format!("bme-tls-test-{}", Uuid::new_v4()));
            let mut file = fs::File::create(&path).expect("to create a temp file");
            file.write_all(contents.as_bytes())
                .expect("to write the temp file");
            Self(path)
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    #[test]
    fn a_broker_with_no_tls_materials_gets_the_system_roots() {
        assert!(client_config(&broker()).is_ok());
    }

    #[test]
    fn a_missing_ca_file_names_the_path_it_could_not_read() {
        let mut connection = broker();
        connection.ca_cert_path = Some("/nonexistent/ca.pem".to_string());

        let err = client_config(&connection).expect_err("a missing file to be rejected");

        assert!(matches!(err, TlsConfigError::FileUnreadable { .. }));
        assert!(err.to_string().contains("/nonexistent/ca.pem"), "{err}");
    }

    /// A file that exists but holds something else - a DER blob, a key, a
    /// README - is a different mistake to a missing one, and worth saying so.
    #[test]
    fn a_ca_file_with_no_certificate_in_it_is_rejected() {
        let file = TempFile::with("not a certificate\n");
        let mut connection = broker();
        connection.ca_cert_path = Some(file.path());

        let err = client_config(&connection).expect_err("a CA-less file to be rejected");

        assert!(matches!(err, TlsConfigError::NoCertificates { .. }));
    }

    #[test]
    fn half_a_client_certificate_pair_is_rejected_before_anything_is_read() {
        let mut connection = broker();
        connection.client_cert_path = Some("/certs/client.pem".to_string());
        assert!(matches!(
            client_config(&connection),
            Err(TlsConfigError::ClientCertWithoutKey)
        ));

        let mut connection = broker();
        connection.client_key_path = Some("/certs/client.key".to_string());
        assert!(matches!(
            client_config(&connection),
            Err(TlsConfigError::ClientKeyWithoutCert)
        ));
    }

    /// Skipping verification also skips loading the CA, so a stale path left
    /// in the field does not block the escape hatch it is there to provide.
    #[test]
    fn skipping_verification_ignores_an_unreadable_ca_file() {
        let mut connection = broker();
        connection.skip_cert_verification = true;
        connection.ca_cert_path = Some("/nonexistent/ca.pem".to_string());

        assert!(client_config(&connection).is_ok());
    }

    #[test]
    fn alpn_is_split_on_commas_and_trimmed() {
        assert_eq!(alpn_protocols(None), Vec::<Vec<u8>>::new());
        assert_eq!(alpn_protocols(Some("   ")), Vec::<Vec<u8>>::new());
        assert_eq!(
            alpn_protocols(Some("x-amzn-mqtt-ca")),
            vec![b"x-amzn-mqtt-ca".to_vec()]
        );
        assert_eq!(
            alpn_protocols(Some("mqtt, x-amzn-mqtt-ca ,")),
            vec![b"mqtt".to_vec(), b"x-amzn-mqtt-ca".to_vec()]
        );
    }

    #[test]
    fn alpn_reaches_the_built_config() {
        let mut connection = broker();
        connection.alpn = Some("x-amzn-mqtt-ca".to_string());

        let config = client_config(&connection).expect("a config to be built");

        assert_eq!(config.alpn_protocols, vec![b"x-amzn-mqtt-ca".to_vec()]);
    }
}
