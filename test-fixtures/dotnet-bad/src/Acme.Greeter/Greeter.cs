namespace Acme.Greeter;

/// <summary>
/// A fixture that fails on purpose: dotnet format would change it, an
/// analyzer warning fails the strict build, and no test calls Describe,
/// so line coverage falls below 80%. Its one test passes.
/// </summary>
public static class Greeter
{
    /// <summary>Returns a greeting for the given name.</summary>
    public static string Greet(string name)   =>  $"Hello, {name}!";

    /// <summary>CA1305: int.Parse depends on the current culture.</summary>
    public static int Parse(string text) => int.Parse(text);

    /// <summary>Describes a visitor count.</summary>
    public static string Describe(int count)
    {
        if (count == 0)
        {
            return "nobody";
        }

        if (count == 1)
        {
            return "one visitor";
        }

        return "several visitors";
    }
}
