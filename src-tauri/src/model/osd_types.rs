use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsdSettings {
    pub enabled: bool,
    pub monitor_index: usize,
    #[serde(default)]
    pub monitor_name: Option<String>,
    #[serde(default)]
    pub monitor_id: Option<String>,
    pub anchor: String,
}

impl Default for OsdSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            monitor_index: 0,
            monitor_name: None,
            monitor_id: None,
            anchor: "top-right".to_string(),
        }
    }
}
