package com.acme.greeter;

import org.jspecify.annotations.Nullable;

/**
 * A fixture that fails on purpose: google-java-format would reformat this
 * file, and Error Prone and NullAway stop the compile.
 */
public final class Greeter {
  private Greeter() {}

  /** Returns a greeting for the given name. */
  public static String greet(String name)   {
    if (name.isEmpty()) {
      // Error Prone: DeadException, the exception is created and never thrown.
      new IllegalArgumentException("name is empty");
    }
    return "Hello, " + name + "!";
  }

  /** NullAway: returns a nullable value from a method declared non-null. */
  public static String nickname(@Nullable String name) {
    return name;
  }
}
