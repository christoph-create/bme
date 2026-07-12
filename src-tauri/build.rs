fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "greet",
            "list_connections",
            "create_connection",
            "delete_connection",
            "connect_broker",
            "disconnect_broker",
            "test_connection",
            "publish_message",
            "subscribe_topic",
            "list_favorites",
            "save_favorite",
        ]),
    ))
    .expect("failed to run tauri-build");
}
