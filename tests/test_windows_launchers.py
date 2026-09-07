"""Run the actual Windows launchers without starting a server or a browser.

The copied project deliberately has no node_modules, Chrome configuration, or
cached calendars. The --help path must work before the application is installed.
"""
import os
import ctypes
from ctypes import wintypes
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import local_app as app


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Windows cmd launchers are exercised by Windows CI")
class WindowsLauncherSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="korean-air-launcher-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.project = self.base / "한국어 경로 (개인 조회)"
        self.project.mkdir()
        self.other_directory = self.base / "다른 작업 폴더"
        self.other_directory.mkdir()
        for name in ("start-windows.bat", "setup-windows.bat", "local_app.py"):
            shutil.copy2(ROOT / name, self.project / name)
        self.system_directory = Path(os.environ["SystemRoot"]) / "System32"
        self.cmd = self.system_directory / "cmd.exe"

    def run_help(self, name, path):
        environment = os.environ.copy()
        environment.update({
            "PATH": path,
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        # /s /c requires an outer pair of quotes around a quoted batch path.
        # Use an absolute path and a different cwd to verify the launcher's %~dp0.
        command = '"%s" /d /s /c ""%s" --help"' % (self.cmd, self.project / name)
        process = subprocess.Popen(
            command, cwd=str(self.other_directory), env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        try:
            output, _ = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            # A launcher regression must not leave a waiting cmd/Python child in CI.
            subprocess.run(
                [str(self.system_directory / "taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
            )
            if process.poll() is None:
                process.kill()
            output, _ = process.communicate(timeout=5)
            self.fail("Launcher did not finish its --help path:\n" + output)
        self.assertEqual(process.returncode, 0, output)
        self.assertFalse((self.project / "data").exists(), output)
        self.assertFalse((self.project / "artifacts").exists(), output)
        return output

    def test_start_help_from_korean_path_and_different_working_directory(self):
        path = str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")
        output = self.run_help("start-windows.bat", path)
        self.assertIn("--port", output)
        self.assertIn("--open", output)

    def test_start_help_needs_only_python_before_node_dependencies_are_installed(self):
        path = os.pathsep.join((str(Path(sys.executable).parent), str(self.system_directory)))
        output = self.run_help("start-windows.bat", path)
        self.assertIn("--port", output)
        self.assertIn("--open", output)

    def test_setup_help_does_not_install_or_require_python_or_node(self):
        output = self.run_help("setup-windows.bat", str(self.system_directory))
        self.assertIn("--check", output)


@unittest.skipUnless(os.name == "nt", "Real taskkill process-tree checks run on Windows CI")
class WindowsProcessTreeSmokeTests(unittest.TestCase):
    def test_cleanup_stops_grandchild_but_preserves_an_unrelated_child(self):
        # An open process handle avoids mistaking PID reuse for a surviving child.
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel32.TerminateProcess.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel32.CloseHandle.restype = wintypes.BOOL
        code = (
            "import json,subprocess,sys,time; "
            "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],"
            "stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
            "print(json.dumps({'status':'ready','childPid':child.pid,'message':'한국어 준비 완료'},"
            "ensure_ascii=False),flush=True); time.sleep(60)"
        )
        parent = unrelated = None
        grandchild_handle = None
        with tempfile.TemporaryDirectory(prefix="korean-air-tree-") as temporary:
            working_directory = Path(temporary) / "한국어 자식 프로세스 (조회)"
            working_directory.mkdir()
            try:
                unrelated = subprocess.Popen(
                    [sys.executable, "-c", "import time; time.sleep(60)"],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    **app.process_creation_options(),
                )
                parent = subprocess.Popen(
                    [sys.executable, "-u", "-c", code], cwd=str(working_directory),
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    env=dict(os.environ, PYTHONIOENCODING="utf-8"),
                    **app.process_creation_options(),
                )
                payload = app.read_handoff_status(parent, timeout=5)
                self.assertEqual(payload["message"], "한국어 준비 완료")
                # SYNCHRONIZE | PROCESS_TERMINATE; terminate is only a test cleanup fallback.
                grandchild_handle = kernel32.OpenProcess(0x00100001, False, payload["childPid"])
                self.assertTrue(grandchild_handle, "Cannot inspect the synthetic grandchild process")
                app.stop_handoff_process(parent)
                self.assertIsNotNone(parent.poll())
                self.assertEqual(kernel32.WaitForSingleObject(grandchild_handle, 5000), 0,
                                 "The owned grandchild survived process-tree cleanup")
                self.assertIsNone(unrelated.poll(), "Cleanup killed an unrelated Python process")
            finally:
                if parent is not None:
                    app.stop_handoff_process(parent)
                if grandchild_handle:
                    if kernel32.WaitForSingleObject(grandchild_handle, 0) == 258:
                        kernel32.TerminateProcess(grandchild_handle, 1)
                        kernel32.WaitForSingleObject(grandchild_handle, 5000)
                    kernel32.CloseHandle(grandchild_handle)
                if unrelated is not None:
                    app.stop_owned_process(unrelated)


if __name__ == "__main__":
    unittest.main()
