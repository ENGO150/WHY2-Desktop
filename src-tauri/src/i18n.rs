/*
This is part of WHY2
Copyright (C) 2026 Václav Šmejkal

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

use std::
{
    fs,
    fmt::Display,
    collections::HashMap,
    sync::{ LazyLock, Mutex, RwLock },
};

use serde::Serialize;

use tauri::AppHandle;

use why2_chat::{ config, misc, i18n };

use crate::types::*;
use crate::settings::client_settings;
use crate::emit::emit;

//ONE LANGUAGE OF THE WINDOW'S OWN TEXT
struct Locale
{
    text: HashMap<String, String>,
    plurals: String,
}

//WHAT THE WEBVIEW DRAWS WITH
#[derive(Serialize, Clone)]
pub(crate) struct LocaleInfo
{
    code: String,
    plurals: String,
    text: HashMap<String, String>,
}

//THE WINDOW'S OWN LOCALES
const BUILTIN: &[(&str, &str)] =
&[
    ("en", include_str!("../locales/en.toml")),
    ("cs", include_str!("../locales/cs.toml")),
    ("de", include_str!("../locales/de.toml")),
    ("es", include_str!("../locales/es.toml")),
    ("fr", include_str!("../locales/fr.toml")),
    ("it", include_str!("../locales/it.toml")),
    ("pt", include_str!("../locales/pt.toml")),
    ("nl", include_str!("../locales/nl.toml")),
    ("pl", include_str!("../locales/pl.toml")),
    ("sk", include_str!("../locales/sk.toml")),
    ("ru", include_str!("../locales/ru.toml")),
    ("uk", include_str!("../locales/uk.toml")),
    ("tr", include_str!("../locales/tr.toml")),
    ("zh", include_str!("../locales/zh.toml")),
    ("ja", include_str!("../locales/ja.toml")),
    ("ko", include_str!("../locales/ko.toml")),
];

//THE CRATE'S KEYS THE WEBVIEW READS
const CRATE_KEYS: &[&str] =
&[
    "account.mismatch",
    "account.title.delete",
    "account.title.passwd",
    "account.label.current",
    "account.label.new",
    "account.label.confirm",
    "account.missing.current",
    "account.missing.new",
    "account.missing.confirm",
    "event.password_refused",
    "event.role",
    "event.wrong_password",
    "hearts.none",
    "hearts.not_loaded",
    "hearts.title",
    "login.connecting",
    "login.label.address",
    "login.label.password",
    "login.label.username",
    "login.password_rejected",
    "login.reconnecting",
    "login.registration_disabled",
    "login.title.login",
    "login.username_rejected",
    "login.username_rules",
    "login.waiting",
    "message.edited",
    "message.voice",
    "palette.commands",
    "palette.mentions",
    "palette.parameters",
    "pane.unread",
    "profile.bio",
    "profile.pronouns",
    "profile.status",
    "profile.website",
    "settings.default_device",
    "settings.empty",
    "settings.restart",
    "settings.row.input_device",
    "settings.row.output_device",
    "settings.save",
    "settings.title.client",
    "settings.title.own_profile",
    "settings.title.server",
    "sidebar.channels",
    "sidebar.offline",
    "sidebar.voice",
    "sidebar.roles.user",
    "sidebar.roles.moderator",
    "sidebar.roles.owner",
    "tofu.challenge",
    "typing.one",
    "typing.two",
    "voice_message.not_loaded",
    "voice_message.not_voice",
    "voice_message.recording",
];

//THE CRATE'S PLURAL TABLES THE WEBVIEW READS
const CRATE_PLURALS: &[&str] = &[ "typing.many" ];

const FORMS: &[&str] = &[ "one", "few", "many", "other" ];

static FALLBACK: LazyLock<Locale> = LazyLock::new(|| parse(BUILTIN[0].1).expect("Parsing the English locale failed"));

static LOADED: LazyLock<Mutex<HashMap<String, Option<&'static Locale>>>> = LazyLock::new(Default::default);

static ACTIVE: LazyLock<RwLock<String>> = LazyLock::new(|| RwLock::new(config::read_config::<String>("language").trim().to_owned()));

//MACROS
#[macro_export]
macro_rules! tr //THE WINDOW'S TEXT, {name} FILLED
{
    (@value $name:ident = $value:expr) => { $value };
    (@value $name:ident) => { $name };

    ($key:literal) => { $crate::i18n::text($key) };

    ($key:literal $(, $name:ident $(= $value:expr)?)+ $(,)?) =>
    {
        $crate::i18n::fill(&$crate::i18n::text($key),
            &[$((stringify!($name), &$crate::tr!(@value $name $(= $value)?) as &dyn ::std::fmt::Display)),+])
    };
}

#[macro_export]
macro_rules! trn //PLURAL TEXT, THE COUNT IS {count}
{
    ($key:literal, $count:expr $(, $name:ident $(= $value:expr)?)* $(,)?) =>
    {{
        let count = $count;

        $crate::i18n::fill(&$crate::i18n::plural($key, count as u64),
            &[("count", &count as &dyn ::std::fmt::Display) $(, (stringify!($name), &$crate::tr!(@value $name $(= $value)?) as &dyn ::std::fmt::Display))*])
    }};
}

//FUNCTIONS
//PRIVATE
fn parse(content: &str) -> Option<Locale>
{
    let table = toml::from_str::<toml::Table>(content).ok()?;
    let mut text = HashMap::new();

    flatten(&table, "", &mut text);

    let plurals = text.remove("meta.plurals").unwrap_or_else(|| String::from("one-other"));

    Some(Locale { text, plurals })
}

//NESTED TABLES TO DOTTED KEYS
fn flatten(table: &toml::Table, prefix: &str, out: &mut HashMap<String, String>)
{
    for (key, value) in table
    {
        let key = format!("{prefix}{key}");

        match value
        {
            toml::Value::Table(table) => flatten(table, &format!("{key}."), out),
            toml::Value::String(text) => { out.insert(key, text.clone()); },
            _ => {},
        }
    }
}

//A FILE IN THE CONFIG DIR WINS
fn load(code: &str) -> Option<&'static Locale>
{
    *LOADED.lock().unwrap().entry(code.to_owned()).or_insert_with(||
    {
        fs::read_to_string(format!("{}/locales/desktop/{code}.toml", misc::get_why2_dir())).ok().and_then(|content| parse(&content))
            .or_else(|| BUILTIN.iter().find(|(name, _)| *name == code).and_then(|(_, content)| parse(content)))
            .map(|locale| &*Box::leak(Box::new(locale)))
    })
}

fn active() -> Option<&'static Locale>
{
    load(&ACTIVE.read().unwrap())
}

//WHICH FORM A COUNT TAKES (i18n.rs::category)
fn category(rule: &str, count: u64) -> &'static str
{
    match rule
    {
        "other" => "other",

        "one-few-other" => match count
        {
            1 => "one",
            2..=4 => "few",
            _ => "other",
        },

        "one-few-many" => match (count % 10, count % 100)
        {
            (1, rest) if rest != 11 => "one",
            (2..=4, rest) if !(12..=14).contains(&rest) => "few",
            _ => "many",
        },

        "polish" => match (count, count % 10, count % 100)
        {
            (1, ..) => "one",
            (_, 2..=4, rest) if !(12..=14).contains(&rest) => "few",
            _ => "many",
        },

        _ => if count == 1 { "one" } else { "other" },
    }
}

fn lookup(locale: &Locale, key: &str) -> Option<String>
{
    locale.text.get(key).cloned()
}

fn plural_in(locale: &Locale, key: &str, count: u64) -> Option<String>
{
    lookup(locale, &format!("{key}.{}", category(&locale.plurals, count))).or_else(|| lookup(locale, &format!("{key}.other")))
}

//PUBLIC
//OURS FIRST, THEN THE CRATE'S, THEN THE KEY
pub(crate) fn text(key: &str) -> String
{
    active().and_then(|locale| lookup(locale, key))
        .or_else(|| lookup(&FALLBACK, key))
        .or_else(|| i18n::get(key).map(str::to_owned))
        .unwrap_or_else(|| key.to_owned())
}

//THE FORM OF key FOR count
pub(crate) fn plural(key: &'static str, count: u64) -> String
{
    active().and_then(|locale| plural_in(locale, key, count))
        .or_else(|| plural_in(&FALLBACK, key, count))
        .unwrap_or_else(|| i18n::plural(key, count).to_owned())
}

//FILL {name} PLACEHOLDERS
pub(crate) fn fill(template: &str, args: &[(&str, &dyn Display)]) -> String
{
    i18n::format(template, args)
}

//THE ACTIVE CODE
pub(crate) fn language() -> String
{
    ACTIVE.read().unwrap().clone()
}

//EVERY LANGUAGE THE CRATE LOADS
pub(crate) fn languages() -> Vec<ChoiceOption>
{
    i18n::languages().into_iter().map(|code| ChoiceOption { label: i18n::language_name(&code).to_owned(), id: code }).collect()
}

//SWITCH BOTH HALVES
pub(crate) fn set_language(app: &AppHandle, code: &str) -> Result<(), String>
{
    if !i18n::languages().iter().any(|language| language == code) { return Err(tr!("bridge.unknown_language")) }

    config::client_write("language", code);
    i18n::set_language(code);

    *ACTIVE.write().unwrap() = code.to_owned();

    #[cfg(desktop)]
    crate::tray::relabel(app);

    #[cfg(target_os = "android")]
    crate::android::relabel();

    emit(app, UiEvent::Locale { locale: get_locale() });
    emit(app, UiEvent::ClientSettings { settings: client_settings() });

    Ok(())
}

//THE WEBVIEW'S COPY
#[tauri::command]
pub(crate) fn get_locale() -> LocaleInfo
{
    let mut text = HashMap::new();

    for key in CRATE_KEYS
    {
        if let Some(value) = i18n::get(key) { text.insert(key.to_string(), value.to_owned()); }
    }

    for key in CRATE_PLURALS
    {
        for form in FORMS
        {
            let full = format!("{key}.{form}");

            if let Some(value) = i18n::get(&full) { text.insert(full, value.to_owned()); }
        }
    }

    for (key, value) in &FALLBACK.text { text.insert(key.clone(), value.clone()); }

    let locale = active();

    if let Some(locale) = locale
    {
        for (key, value) in &locale.text { text.insert(key.clone(), value.clone()); }
    }

    LocaleInfo
    {
        code: language(),
        plurals: locale.map(|locale| locale.plurals.clone()).unwrap_or_else(|| FALLBACK.plurals.clone()),
        text,
    }
}
