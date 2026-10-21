// Keep the release build from opening a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--statusline") {
        claude_juice_lib::statusline();
        return;
    }
    claude_juice_lib::run()
}
