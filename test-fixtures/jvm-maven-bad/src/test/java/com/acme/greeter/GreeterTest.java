package com.acme.greeter;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class GreeterTest {
  @Test
  void greetsByName() {
    assertEquals("Hello, Acme!", Greeter.greet("Acme"));
  }
}
