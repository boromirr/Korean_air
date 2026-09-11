#!/usr/bin/env python3
"""Dependency-free Android build using official SDK build tools and JDK 17.

ANDROID_JAR: path to platforms/android-35/android.jar
ANDROID_BUILD_TOOLS: directory containing aapt2, zipalign and lib/d8.jar
APK_KEYSTORE: private signing key path, excluded from source control
APK_STORE_PASSWORD: signing password, default 'android' for personal test builds
"""
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build"
SDK_JAR = Path(os.environ["ANDROID_JAR"]).resolve()
TOOLS = Path(os.environ["ANDROID_BUILD_TOOLS"]).resolve()
KEY = Path(os.environ.get("APK_KEYSTORE", str(ROOT / ".signing/personal-test.jks"))).resolve()
os.environ.setdefault("APK_STORE_PASSWORD", "android")

def run(*args):
    subprocess.run([str(x) for x in args], cwd=ROOT, check=True)

def main():
    if OUT.exists(): shutil.rmtree(OUT)
    for folder in ("generated", "classes", "dex"): (OUT / folder).mkdir(parents=True, exist_ok=True)
    run(TOOLS / "aapt2", "compile", "--dir", ROOT / "app/src/main/res", "-o", OUT / "resources.zip")
    run(TOOLS / "aapt2", "link", "-o", OUT / "resources.apk", "-I", SDK_JAR,
        "--manifest", ROOT / "app/src/main/AndroidManifest.xml", "--java", OUT / "generated",
        "-A", ROOT / "app/src/main/assets", "--min-sdk-version", "26", "--target-sdk-version", "35", OUT / "resources.zip")
    sources = sorted((ROOT / "app/src/main/java").rglob("*.java")) + sorted((OUT / "generated").rglob("*.java"))
    run("java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-source", "8", "-target", "8",
        "-bootclasspath", str(TOOLS / "core-lambda-stubs.jar") + os.pathsep + str(SDK_JAR), "-d", OUT / "classes", *sources)
    with zipfile.ZipFile(OUT / "classes.jar", "w") as z:
        for file in sorted((OUT / "classes").rglob("*.class")): z.write(file, file.relative_to(OUT / "classes"))
    run("java", "-cp", TOOLS / "lib/d8.jar", "com.android.tools.r8.D8", "--release", "--lib", SDK_JAR, "--min-api", "26", "--output", OUT / "dex", OUT / "classes.jar")
    shutil.copyfile(OUT / "resources.apk", OUT / "unaligned.apk")
    with zipfile.ZipFile(OUT / "unaligned.apk", "a", compression=zipfile.ZIP_DEFLATED) as z:
        for dex in (OUT / "dex").glob("*.dex"): z.write(dex, dex.name)
    run(TOOLS / "zipalign", "-f", "-p", "4", OUT / "unaligned.apk", OUT / "unsigned.apk")
    if not KEY.exists():
        KEY.parent.mkdir(parents=True, exist_ok=True)
        run("keytool", "-genkeypair", "-keystore", KEY, "-storetype", "JKS", "-alias", "personal-test", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
            "-storepass:env", "APK_STORE_PASSWORD", "-keypass:env", "APK_STORE_PASSWORD", "-dname", "CN=Personal Android Test")
        KEY.chmod(0o600)
    apk = OUT / "KoreanAirPersonal.apk"
    run("java", "-jar", TOOLS / "lib/apksigner.jar", "sign", "--ks", KEY, "--ks-key-alias", "personal-test", "--ks-pass", "env:APK_STORE_PASSWORD", "--key-pass", "env:APK_STORE_PASSWORD", "--out", apk, OUT / "unsigned.apk")
    run("java", "-jar", TOOLS / "lib/apksigner.jar", "verify", "--verbose", apk)
    run(TOOLS / "zipalign", "-c", "-p", "4", apk)
    print(f"Built: {apk} ({apk.stat().st_size:,} bytes)")

if __name__ == "__main__": main()
