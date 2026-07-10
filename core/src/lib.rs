pub mod models;
pub mod mqtt;
pub mod storage;

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_wiring_is_sane() {
        assert_eq!(2 + 2, 4);
    }
}
