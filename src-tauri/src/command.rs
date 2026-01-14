use serde::Serialize;

use why2::chat::command;

#[derive(Serialize)]
pub struct CommandArgDto
{
    name: String,
    required: bool,
}

#[derive(Serialize)]
pub struct CommandInfoDto
{
    name: String,
    triggers: Vec<String>,
    args: Vec<CommandArgDto>,
    description: String,
}

#[tauri::command]
pub fn get_commands() -> (String, Vec<CommandInfoDto>)
{
    let prefix = command::COMMAND_PREFIX.to_string();

    let commands = command::COMMAND_LIST.iter().map(|cmd|
    {
        CommandInfoDto
        {
            name: cmd.triggers.first().unwrap_or(&"?").to_string(),
            triggers: cmd.triggers.iter().map(|s| s.to_string()).collect(),
            args: cmd.args.iter().map(|arg| CommandArgDto
            {
                name: arg.name.to_string(),
                required: arg.required,
            }).collect(),
            description: cmd.description.to_string(),
        }
    }).collect();

    (prefix, commands)
}
