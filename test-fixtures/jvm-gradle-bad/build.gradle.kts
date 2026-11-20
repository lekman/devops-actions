// A fixture that fails on purpose. It applies no coverage plugin, so the
// jvm-quality action injects JaCoCo, and its source breaks ktlint, detekt
// and the coverage floor while its one test passes.
plugins {
    kotlin("jvm") version "2.4.21"
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.1.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}
