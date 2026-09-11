#!/usr/bin/env python3
"""Offline functional checks; downloads only the test JSON dependency on first run."""
from pathlib import Path
import hashlib
import os
import subprocess
import urllib.request

ROOT=Path(__file__).resolve().parent
JAR=ROOT/'tests/json-20240303.jar'
URL='https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar'
SHA256='3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed'
def main():
    if not JAR.exists():
        with urllib.request.urlopen(URL,timeout=30) as r: JAR.write_bytes(r.read())
    if hashlib.sha256(JAR.read_bytes()).hexdigest()!=SHA256: raise RuntimeError('Test JSON dependency checksum mismatch')
    out=ROOT/'build/tests';out.mkdir(parents=True,exist_ok=True)
    source=ROOT/'app/src/main/java/com/boromirr/mileagedays'
    subprocess.run(['java','-m','jdk.compiler/com.sun.tools.javac.Main','-encoding','UTF-8','-cp',str(JAR),'-d',str(out),str(source/'AwardCore.java'),str(source/'AwardClient.java'),str(ROOT/'tests/CoreTest.java')],check=True)
    subprocess.run(['java','-cp',str(out)+os.pathsep+str(JAR),'com.boromirr.mileagedays.CoreTest',str(ROOT/'tests/icn-jfk-202611.json')],check=True)
if __name__=='__main__':main()
