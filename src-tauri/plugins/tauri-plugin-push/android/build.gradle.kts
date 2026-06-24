plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "gg.localforge.push"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34
        consumerProguardFiles("proguard-rules.pro")
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Firebase Cloud Messaging — the device token + delivery. The BoM pins a
    // consistent set; firebase-messaging brings the FirebaseMessaging API.
    //
    // ⚠️ DEVICE-SESSION REQUIREMENT: for FirebaseMessaging.getInstance() to
    // initialise, the APP module (generated under gen/android) must (a) carry
    // a google-services.json and (b) apply the `com.google.gms.google-services`
    // Gradle plugin. Those live in the generated project, so they're injected
    // post-`tauri android init` via a CI patch script (see
    // scripts/patch-android-firebase.cjs) — NOT here in the library module.
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    // Tauri drops its generated Android library here during the build.
    implementation(project(":tauri-android"))
}
