use super::binding_types::Binding;
use super::osd_types::OsdSettings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct MidiDevicePreference {
    pub input_device_id: Option<String>,
    pub output_device_id: Option<String>,
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub bindings: Vec<Binding>,
    #[serde(default)]
    pub osd_settings: OsdSettings,
    #[serde(default)]
    pub plugin_settings: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub midi_device_preference: MidiDevicePreference,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSummary {
    pub name: String,
}
