package com.acme.greeter

/** Builds greetings for Acme visitors. */
object Greeter {
    fun greet(name: String): String = "Hello, $name!"

    // ktlint: the spacing around the colon and the brace are wrong.
    fun shout(name:String):String{
        return greet(name).uppercase()
    }

    // detekt: MagicNumber. No test calls this, so coverage falls below 80%.
    fun discount(total: Int): Int {
        if (total > 1000) {
            return total - 250
        }
        if (total > 500) {
            return total - 75
        }
        return total
    }
}
