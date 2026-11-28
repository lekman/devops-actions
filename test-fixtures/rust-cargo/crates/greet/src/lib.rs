//! Builds a greeting.

/// Returns a greeting for `name`.
///
/// ```
/// assert_eq!(greet::greeting("Ada"), "Hello, Ada!");
/// ```
pub fn greeting(name: &str) -> String {
    format!("Hello, {name}!")
}

#[cfg(test)]
mod tests {
    use super::greeting;

    #[test]
    fn greets_by_name() {
        assert_eq!(greeting("Grace"), "Hello, Grace!");
    }
}
