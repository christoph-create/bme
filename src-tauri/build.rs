fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "greet",
            "open_log_dir",
            "list_connections",
            "create_connection",
            "update_connection",
            "delete_connection",
            "connect_broker",
            "disconnect_broker",
            "test_connection",
            "publish_message",
            "subscribe_topic",
            "list_favorites",
            "create_favorite",
            "get_favorite",
            "update_favorite",
            "delete_favorite",
            "list_favorite_collections",
            "create_favorite_collection",
            "get_favorite_collection",
            "update_favorite_collection",
            "delete_favorite_collection",
        ]),
    ))
    .expect("failed to run tauri-build");
}
