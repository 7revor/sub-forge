#!/usr/bin/env python3
"""本地开发服务控制：Vite 热更新与后端源码监听，不执行构建。"""

import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def command(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def process_status(pid):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1:
        return None
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "stat=,lstart=,command="],
        text=True, capture_output=True, check=False, env={**os.environ, "LC_ALL": "C"},
    )
    if result.returncode == 1 and not result.stdout.strip():
        return None
    if result.returncode != 0:
        raise RuntimeError(f"无法检查进程 {pid}：{result.stderr.strip()}")
    parts = result.stdout.strip().split(maxsplit=6)
    if len(parts) != 7:
        raise RuntimeError(f"无法识别进程 {pid} 的状态")
    if parts[0].startswith("Z"):
        return None
    return {"startTime": " ".join(parts[1:6]), "command": parts[6]}


def process_info(pid):
    info = process_status(pid)
    if info is None:
        return None
    cwd = subprocess.run(
        ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
        text=True, capture_output=True, check=False,
    )
    # 进程可能在 ps 与 lsof 之间退出，不能把正常退出误判为身份不符。
    current = process_status(pid)
    if current is None:
        return None
    if current != info:
        raise RuntimeError(f"检查期间 PID {pid} 的身份发生变化，未发送任何信号")
    info["cwd"] = next((line[1:] for line in cwd.stdout.splitlines() if line.startswith("n")), None)
    return info


def group_running(pgid):
    result = command("ps", "-axo", "pgid=,stat=")
    return any(parts[0] == str(pgid) and not parts[1].startswith("Z")
               for line in result.splitlines() if len(parts := line.split()) == 2)


class LocalService:
    def __init__(self):
        # 启动脚本所在工作树的源码；数据默认仍复用主仓库的本地运行目录。
        script_dir = Path(__file__).resolve().parent
        common = command("git", "-C", str(Path(__file__).resolve().parent),
                         "rev-parse", "--path-format=absolute", "--git-common-dir")
        self.root = Path(command("git", "-C", str(script_dir), "rev-parse", "--show-toplevel"))
        main_root = Path(common).parent
        legacy = main_root / ".Codex/runtime/m1-stabilization"
        default = legacy if (legacy / "sub-forge.db").is_file() else main_root / ".Codex/runtime/local-service"
        self.runtime = Path(os.environ.get("SUBFORGE_LOCAL_RUNTIME_DIR", str(default))).expanduser().resolve()
        self.state_file = self.runtime / "service.json"
        self.pid_file = self.runtime / "service.pid"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def read_state(self):
        if not self.state_file.exists():
            if self.pid_file.exists():
                raise RuntimeError("只有 PID 文件而没有服务记录，无法核对进程；未发送任何信号")
            return {}
        state = json.loads(self.state_file.read_text())
        if not isinstance(state, dict):
            raise RuntimeError("service.json 格式错误，未修改进程")
        return state

    def write_state(self, state):
        # 原子替换，避免中断后只留下半份 PID / 服务记录。
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.runtime,
                                         prefix=".service-", delete=False) as output:
            json.dump(state, output, ensure_ascii=False, indent=2)
            output.write("\n")
            filename = output.name
        os.replace(filename, self.state_file)

    def owned_process(self, state):
        info = process_info(state.get("pid"))
        if info is None:
            return None
        expected_cwd = state.get("cwd") or str(Path(state.get("worktree", str(self.root))) / "packages/server")
        expected_command = state.get("command")
        command_ok = info["command"] == expected_command if expected_command else (
            info["command"].endswith("/node --import tsx src/cli.ts serve"))
        if (not command_ok or info["cwd"] != expected_cwd
                or (state.get("startTime") and info["startTime"] != state["startTime"])):
            raise RuntimeError(f"PID {state['pid']} 与服务记录不符，未启动新实例，也未停止该进程")
        return info

    def healthy(self, url, path="/healthz", contains=None):
        try:
            with self.opener.open(url + path, timeout=1) as response:
                return response.status == 200 and (contains is None or contains in response.read())
        except OSError as error:
            self.last_health_error = str(error)
            return False

    def mark_stopped(self, state):
        state.update(previousPid=state.get("pid") or state.get("previousPid"), pid=None, pgid=None,
                     status="stopped", stoppedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        self.write_state(state)
        self.pid_file.unlink(missing_ok=True)

    def stop(self):
        state = self.read_state()
        info = self.owned_process(state)
        if not info:
            if state.get("pgid") and group_running(state["pgid"]):
                raise RuntimeError("管理进程已退出，但进程组仍在运行；请检查日志与进程记录，未盲目发送信号")
            self.mark_stopped(state)
            print("服务已经停止。数据库和密钥保留。")
            return
        pid = state["pid"]
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            print(f"PID {pid} 已在停止检查期间退出。")
        deadline = time.monotonic() + 30
        while True:
            # 发信号前完整核验身份；退出等待只看进程及启动时间，避免读取正在关闭的目录。
            current = process_status(pid)
            if current is None or current["startTime"] != info["startTime"]:
                if not state.get("pgid") or not group_running(state["pgid"]):
                    break
            if time.monotonic() >= deadline:
                raise RuntimeError(f"PID {pid} 仍未退出，已保留进程记录，未强制终止。请检查 {state.get('log')}")
            time.sleep(0.2)
        self.mark_stopped(state)
        print(f"服务已停止（原 PID {pid}）。数据库和密钥保留。")

    def start(self):
        state = self.read_state()
        if self.owned_process(state):
            if state.get("mode") != "dev":
                raise RuntimeError("旧的静态托管服务仍在运行，请先执行停止脚本，再启动开发服务")
            if (not self.healthy(state["apiUrl"]) or not self.healthy(state["url"])
                    or not self.healthy(state["url"], "/", b"/@vite/client")):
                raise RuntimeError(f"服务进程仍在运行，但健康检查未通过；请先停止再启动。日志：{state.get('log')}")
            print(f"开发服务已经运行：{state['url']}（PID {state['pid']}），未重复启动。")
            return
        if state.get("pgid") and group_running(state["pgid"]):
            raise RuntimeError("上次开发服务的进程组仍在运行，请检查日志与进程记录")
        port = int(os.environ.get("SUBFORGE_LOCAL_PORT", "8080"))
        web_port = int(os.environ.get("SUBFORGE_LOCAL_WEB_PORT", "5173"))
        if not all(1 <= value <= 65535 for value in (port, web_port)) or port == web_port:
            raise RuntimeError("前后端端口必须是 1–65535 的不同整数")
        api_url, url = f"http://127.0.0.1:{port}", f"http://127.0.0.1:{web_port}"
        for value in (port, web_port):
            with socket.socket() as probe:
                try:
                    probe.bind(("127.0.0.1", value))
                except OSError as error:
                    raise RuntimeError(f"端口 {value} 已被占用，未停止其他进程：{error}") from error
        database = self.runtime / "sub-forge.db"
        if database.exists() and not (self.runtime / "secret.key").is_file():
            raise RuntimeError("现有数据库旁缺少 secret.key；为避免使用错误密钥，已取消启动")
        node = shutil.which("node")
        if not node:
            raise RuntimeError("需要 Node.js 22 或更高版本，请安装后重新运行")
        if int(command(node, "-p", 'process.versions.node.split(".")[0]')) < 22:
            raise RuntimeError("Node.js 版本低于 22，请升级后重新运行")
        if not all((self.root / path).exists() for path in (
                "packages/server/node_modules/tsx", "packages/web/node_modules/vite/bin/vite.js")):
            raise RuntimeError(f"尚未安装依赖，请在 {self.root} 执行 pnpm install --frozen-lockfile")
        print("正在启动开发服务（前端 Vite 热更新 / 后端源码监听）…", flush=True)
        log_path = self.runtime / "server.log"
        env = os.environ.copy()
        # 本地脚本始终使用数据库旁的密钥，避免终端遗留的密钥覆盖现有文件。
        env.pop("SUBFORGE_SECRET", None)
        env.pop("WEB_DIR", None)
        env.update(HOST="127.0.0.1", PORT=str(port), PUBLIC_URL=url,
                   SUBFORGE_DB=str(database), SUBFORGE_API=api_url,
                   SUBFORGE_LOCAL_WEB_PORT=str(web_port), NODE_ENV="development")
        cwd = self.root
        with log_path.open("ab") as log:
            process = subprocess.Popen([node, str(Path(__file__).with_name("dev-service.mjs"))], cwd=cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        try:
            info = process_info(process.pid)
            if info is None or info["cwd"] != str(cwd):
                raise RuntimeError("服务启动后退出或工作目录核验失败")
            state.pop("webDir", None)
            state.update(info, pid=process.pid, pgid=process.pid, mode="dev", status="starting",
                         host="127.0.0.1", port=port, webPort=web_port, url=url, apiUrl=api_url,
                         worktree=str(self.root), database=str(database), log=str(log_path),
                         branch=command("git", "-C", str(self.root), "branch", "--show-current"),
                         commit=command("git", "-C", str(self.root), "rev-parse", "--short", "HEAD"),
                         startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            self.write_state(state)
            self.pid_file.write_text(str(process.pid) + "\n")
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"服务提前退出（退出码 {process.returncode}）")
                listener = subprocess.run(["lsof", "-nP", "-a", "-g", str(process.pid),
                                           f"-iTCP:{port},{web_port}", "-sTCP:LISTEN", "-Fn"],
                                          capture_output=True, text=True, check=False)
                listens = listener.stdout.splitlines()
                if (all(f"n127.0.0.1:{value}" in listens for value in (port, web_port))
                        and self.healthy(api_url) and self.healthy(url)
                        and self.healthy(url, "/", b"/@vite/client")):
                    state["status"] = "running"
                    self.write_state(state)
                    print(f"开发服务已启动：{url}\n后端：{api_url}\n源码：{self.root}\nPID：{process.pid}\n日志：{log_path}")
                    return
                time.sleep(0.2)
            raise RuntimeError(f"服务健康检查超时：{getattr(self, 'last_health_error', '未开始监听')}")
        except BaseException:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    print("本次启动失败的进程未正常退出，正在清理该进程。", file=sys.stderr)
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            self.mark_stopped(state)
            print(f"本次启动失败，后台进程已清理。请检查日志：{log_path}", file=sys.stderr)
            raise

    def run(self, action):
        self.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        # 文件锁随控制脚本退出自动释放，服务子进程不继承锁。
        with (self.runtime / "service.lock").open("a") as lock:
            deadline = time.monotonic() + 30
            while True:
                try:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("另一个启动 / 停止操作仍在执行，请稍后重试")
                    time.sleep(0.2)
            getattr(self, action)()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sub-Forge 本地服务启动 / 停止")
    parser.add_argument("action", choices=["start", "stop"])
    args = parser.parse_args()
    try:
        LocalService().run(args.action)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"操作失败：{error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("操作已取消。", file=sys.stderr)
        sys.exit(130)
