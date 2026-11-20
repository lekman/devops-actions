namespace Acme.Greeter.Tests;

public class GreeterTests
{
    [Fact]
    public void GreetsByName() => Assert.Equal("Hello, Acme!", Greeter.Greet("Acme"));
}
