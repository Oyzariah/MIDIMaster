use crate::model::{self, LearnedControl};

#[derive(Debug, Clone)]
pub(crate) struct LearnCandidate {
    pub control: LearnedControl,
    pub last_seen_at: std::time::Instant,
    pub saw_zero: bool,
    pub saw_max: bool,
}

#[cfg(target_os = "windows")]
pub(crate) fn send_media_key(vk: u16) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    let key_down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: KEYBD_EVENT_FLAGS(0),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let key_up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        SendInput(&[key_down, key_up], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn send_media_key(_vk: u16) {
    // no-op on unsupported platforms
}

fn classify_cc_candidate(saw_zero: bool, saw_max: bool) -> model::BindingControlKind {
    if saw_zero && saw_max {
        model::BindingControlKind::Button
    } else {
        model::BindingControlKind::Continuous
    }
}

pub(crate) fn classify_learned_control(candidate: &LearnCandidate) -> LearnedControl {
    let mut learned = candidate.control.clone();
    learned.control_kind = match learned.msg_type {
        model::MidiMessageType::Note => model::BindingControlKind::Button,
        model::MidiMessageType::ControlChange => {
            classify_cc_candidate(candidate.saw_zero, candidate.saw_max)
        }
        model::MidiMessageType::PitchBend => model::BindingControlKind::Continuous,
    };
    learned
}
