package com.acme.greeter;

/** Builds greetings for Acme visitors. */
public final class Greeter {
  private Greeter() {}

  /** Returns a greeting for the given name. */
  public static String greet(String name) {
    return "Hello, " + name + "!";
  }
}
