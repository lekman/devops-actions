//! Builds a greeting, badly.

/// Returns a greeting for `name`.
pub fn greeting(name: &str) -> String {
    let greeting = format!("Hello, {name}!");
    return greeting;
}

/// Formatted the wrong way on purpose.
pub fn shout(name: &str) -> String { greeting(name).to_uppercase() }

#[cfg(test)]
mod tests {
    use super::greeting;

    #[test]
    fn greets_by_name() {
        assert_eq!(greeting("Grace"), "Hi, Grace!");
    }
}
