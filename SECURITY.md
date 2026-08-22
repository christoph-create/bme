# Security Policy

## Supported versions

bme is a small side project with a single active line of development. Only the
most recent release gets fixes; there are no maintained branches for older
versions.

| Version           | Supported          |
| ----------------- | ------------------ |
| Latest release    | :white_check_mark: |
| Anything older    | :x:                |

If you're on an older build, the first step for any issue — security or not — is
to update. bme tells you when a newer release exists, and there's a
"Check for updates" button in the footer of the connections screen.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:

**https://github.com/christoph-create/bme/security/advisories/new**

That form is visible only to the maintainer. Please include what you found, how
to reproduce it, the bme version, and your platform. A proof of concept is
welcome but not required.

What to expect: I read these, but this is an unfunded side project built in my
free time, so I can't promise a response time. Realistically, expect an
acknowledgement within a couple of weeks. If something is being actively
exploited, say so prominently and I'll prioritise it. I'll credit you in the
release notes when a report leads to a fix, unless you'd rather I didn't.

## Scope — things that are known and by design

bme is a local desktop application. It has no server component, no backend, no
telemetry, and no account system. That shapes what does and doesn't count as a
vulnerability here:

- **Broker credentials and certificate paths are stored unencrypted** in a local
  SQLite database in the app's data directory. There is no master password and
  no at-rest encryption. This is a known limitation, not an oversight — the
  database is protected by your operating system's file permissions and nothing
  more. If your threat model includes another process running as your user, bme
  does not defend against that today.
- **There is no sandbox between the app and your filesystem.** bme reads the CA
  and client-certificate files you point it at, with your own permissions.
- **Session message history is in memory only** and is never written to disk.
- **`--insecure`-style behaviour is explicit and opt-in.** The "skip
  certificate verification" toggle on a connection does exactly what it says;
  using it is a decision you make per broker.
- **The only outbound network requests bme makes on its own** are to the GitHub
  releases API, at most once a day, to check whether a newer version exists. It
  never downloads or installs anything by itself.

Reports about the above are welcome as *feature requests* for hardening — open
a normal issue for those. What I'd genuinely want to know about privately:
anything that lets a remote broker, an imported template file, or a crafted MQTT
payload cause code execution, escape the webview, read files it shouldn't, or
exfiltrate stored credentials.
