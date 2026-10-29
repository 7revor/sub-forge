"""在独立临时目录和空闲端口验证服务脚本，不接触现有用户数据。"""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request


SCRIPTS = Path(__file__).resolve().parent


class LocalServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sub-forge 服务脚本 ")
        self.runtime = Path(self.temp.name)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
            with socket.socket() as web_probe:
                web_probe.bind(("127.0.0.1", 0))
                self.web_port = web_probe.getsockname()[1]
        self.env = {**os.environ, "SUBFORGE_LOCAL_RUNTIME_DIR": str(self.runtime),
                    "SUBFORGE_LOCAL_PORT": str(self.port), "SUBFORGE_LOCAL_WEB_PORT": str(self.web_port)}
        self.state_file = self.runtime / "service.json"
        self.good_state = None

    def run_script(self, action, expected=0):
        result = subprocess.run([str(SCRIPTS / f"{action}-local.command")], env=self.env,
                                text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def state(self):
        return json.loads(self.state_file.read_text())

    def write_state(self, state):
        self.state_file.write_text(json.dumps(state))

    def listener_pid(self, port):
        result = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fp"],
                                text=True, capture_output=True, check=False)
        return next((int(line[1:]) for line in result.stdout.splitlines() if line.startswith("p")), None)

    def assert_no_service_processes(self, pgid):
        result = subprocess.check_output(["ps", "-axo", "pgid=,stat="], text=True)
        self.assertFalse(any(parts[0] == str(pgid) and not parts[1].startswith("Z")
                             for line in result.splitlines() if len(parts := line.split()) == 2))

    def tearDown(self):
        if self.good_state:
            self.write_state(self.good_state)
        try:
            self.run_script("stop")
        finally:
            self.temp.cleanup()

    def test_启动重复启动身份核验和重复停止(self):
        self.env.update(SUBFORGE_ADMIN_USERNAME="devtest", SUBFORGE_ADMIN_PASSWORD="dev-script-test-password")
        self.assertIn("服务已启动", self.run_script("start"))
        self.good_state = self.state()
        pid = self.good_state["pid"]
        self.assertTrue((self.runtime / "sub-forge.db").is_file())
        self.assertEqual((self.runtime / "secret.key").stat().st_mode & 0o777, 0o600)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{self.port}/healthz", timeout=2) as response:
            self.assertEqual(response.status, 200)
        web_url = f"http://127.0.0.1:{self.web_port}"
        with opener.open(web_url, timeout=5) as response:
            self.assertIn(b"/@vite/client", response.read())
        with opener.open(web_url + "/@vite/client", timeout=5) as response:
            self.assertEqual(response.status, 200)
        with opener.open(web_url + "/healthz", timeout=5) as response:
            self.assertEqual(response.status, 200)
        login = urllib.request.Request(web_url + "/api/auth/login", method="POST",
            data=json.dumps({"username": "devtest", "password": "dev-script-test-password"}).encode(),
            headers={"Content-Type": "application/json", "Origin": web_url})
        with opener.open(login, timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("HttpOnly", response.headers.get("Set-Cookie", ""))
        self.assertEqual(self.good_state["mode"], "dev")
        self.assertFalse((self.runtime / "web-local").exists())
        self.assertIn("未重复启动", self.run_script("start"))
        self.assertEqual(self.state()["pid"], pid)
        self.write_state({**self.good_state, "startTime": "错误的启动时间"})
        self.assertIn("服务记录不符", self.run_script("stop", expected=1))
        os.kill(pid, 0)
        self.write_state(self.good_state)
        self.assertIn("服务已停止", self.run_script("stop"))
        self.good_state = None
        self.assertIsNone(self.state()["pid"])
        self.assertFalse((self.runtime / "service.pid").exists())
        self.assertIn("已经停止", self.run_script("stop"))
        for port in (self.port, self.web_port):
            with socket.socket() as probe:
                self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)
        self.assert_no_service_processes(pid)
        self.assertTrue((self.runtime / "sub-forge.db").is_file())
        self.assertTrue((self.runtime / "secret.key").is_file())

    def test_同时启动仅生成一个实例(self):
        args = [str(SCRIPTS / "start-local.command")]
        children = [subprocess.Popen(args, env=self.env, text=True, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT) for _ in range(2)]
        outputs = []
        try:
            for child in children:
                output, _ = child.communicate(timeout=90)
                outputs.append(output)
                self.assertEqual(child.returncode, 0, output)
            self.good_state = self.state()
            self.assertEqual(sum("服务已启动：" in output for output in outputs), 1)
            self.assertEqual(sum("未重复启动" in output for output in outputs), 1)
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=35)

    def test_记录其他进程的PID不会误杀(self):
        process = subprocess.Popen([shutil.which("node"), "-e", "setInterval(() => {}, 1000)"])
        try:
            self.write_state({"pid": process.pid, "worktree": str(SCRIPTS.parent)})
            self.assertIn("服务记录不符", self.run_script("stop", expected=1))
            self.assertIsNone(process.poll())
        finally:
            process.terminate()
            process.wait(timeout=5)
            self.write_state({"pid": None, "status": "stopped"})

    def test_失效PID可安全停止(self):
        self.write_state({"pid": 2147483647})
        (self.runtime / "service.pid").write_text("2147483647\n")
        self.assertIn("已经停止", self.run_script("stop"))
        self.assertIsNone(self.state()["pid"])

    def test_端口被占用时不启动(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", self.port))
            listener.listen()
            self.assertIn("已被占用", self.run_script("start", expected=1))
            self.assertFalse((self.runtime / "service.pid").exists())
            self.assertEqual(listener.getsockname()[1], self.port)

    def test_前端端口被占用时不启动也不换端口(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", self.web_port))
            listener.listen()
            self.assertIn("已被占用", self.run_script("start", expected=1))
            self.assertFalse((self.runtime / "service.pid").exists())
            self.assertIsNone(self.listener_pid(self.port))

    def test_现有数据库缺少密钥时拒绝启动(self):
        database = self.runtime / "sub-forge.db"
        database.write_bytes("原数据库的占位内容".encode("utf-8"))
        self.assertIn("缺少 secret.key", self.run_script("start", expected=1))
        self.assertFalse((self.runtime / "secret.key").exists())
        self.assertFalse((self.runtime / "service.pid").exists())

    def test_启动不调用打包命令(self):
        binary = self.runtime / "测试命令目录"
        binary.mkdir()
        pnpm = binary / "pnpm"
        pnpm.write_text("#!/bin/sh\necho 不应调用打包命令 >&2\nexit 9\n")
        pnpm.chmod(0o755)
        self.env["PATH"] = str(binary) + os.pathsep + self.env["PATH"]
        self.assertIn("开发服务已启动", self.run_script("start"))
        self.good_state = self.state()
        self.assertFalse((self.runtime / "web-local").exists())

    def test_后端与核心源码变化自动重启(self):
        self.run_script("start")
        self.good_state = self.state()
        root = Path(self.good_state["worktree"])
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        originals = []
        try:
            for name in ("packages/server/src/cli.ts", "packages/core/src/index.ts"):
                file = root / name
                originals.append((file, file.stat()))
                previous_pid = self.listener_pid(self.port)
                self.assertIsNotNone(previous_pid)
                os.utime(file, None)
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    pid = self.listener_pid(self.port)
                    if pid is not None and pid != previous_pid:
                        with opener.open(self.good_state["apiUrl"] + "/healthz", timeout=2) as response:
                            self.assertEqual(response.status, 200)
                        break
                    time.sleep(0.2)
                else:
                    self.fail(f"修改 {name} 后没有自动重启后端")
                self.assertEqual(self.state()["pid"], self.good_state["pid"])
        finally:
            try:
                self.run_script("stop")
                self.good_state = None
            finally:
                for file, original in originals:
                    os.utime(file, ns=(original.st_atime_ns, original.st_mtime_ns))

    def test_前端启动失败会同时停止后端(self):
        preload = self.runtime / "fail-vite.cjs"
        preload.write_text("if (process.argv[1]?.endsWith('/vite/bin/vite.js')) { process.exit(7); }\n")
        self.env["NODE_OPTIONS"] = f'--require "{preload}"'
        self.assertIn("后台进程已清理", self.run_script("start", expected=1))
        state = self.state()
        self.assertIsNone(state["pid"])
        self.assert_no_service_processes(state["previousPid"])
        self.assertIsNone(self.listener_pid(self.port))

    def test_兼容停止旧版单进程服务(self):
        root = SCRIPTS.parent
        process = subprocess.Popen([shutil.which("node"), "--import", "tsx", "src/cli.ts", "serve"],
            cwd=root / "packages/server", env={**self.env, "SUBFORGE_DB": str(self.runtime / "sub-forge.db"),
                "PORT": str(self.port), "PUBLIC_URL": f"http://127.0.0.1:{self.port}"},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 10
            while self.listener_pid(self.port) != process.pid:
                self.assertIsNone(process.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.1)
            self.write_state({"pid": process.pid, "worktree": str(root)})
            self.assertIn("旧的静态托管服务", self.run_script("start", expected=1))
            self.assertIn("服务已停止", self.run_script("stop"))
            process.wait(timeout=5)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            self.write_state({"pid": None, "status": "stopped"})

    def test_服务启动失败会清理进程记录(self):
        (self.runtime / "sub-forge.db").write_text("不是 SQLite 数据库\n" * 10)
        (self.runtime / "secret.key").write_text("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n")
        self.assertIn("后台进程已清理", self.run_script("start", expected=1))
        state = self.state()
        self.assertIsNone(state["pid"])
        self.assertEqual(state["status"], "stopped")
        with self.assertRaises(ProcessLookupError):
            os.kill(state["previousPid"], 0)
        self.assert_no_service_processes(state["previousPid"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
