namespace Acme.Greeter;

/// <summary>Builds greetings for Acme visitors.</summary>
public static class Greeter
{
    /// <summary>Returns a greeting for the given name.</summary>
    public static string Greet(string name) => $"Hello, {name}!";
}
