#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceTargetKind {
    Playback,
    Recording,
}

pub fn parse_device_target(device_id: &str) -> (DeviceTargetKind, &str) {
    if let Some(raw) = device_id.strip_prefix("recording:") {
        return (DeviceTargetKind::Recording, raw);
    }
    if let Some(raw) = device_id.strip_prefix("playback:") {
        return (DeviceTargetKind::Playback, raw);
    }
    (DeviceTargetKind::Playback, device_id)
}
