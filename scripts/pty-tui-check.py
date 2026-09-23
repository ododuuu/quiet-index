import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time

node, cli, mode = sys.argv[1], sys.argv[2], sys.argv[3]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
pid = os.fork()
if pid == 0:
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(master)
    os.close(slave)
    os.execv(node, [node, cli, "tui"])
os.close(slave)
buf = b""
deadline = time.time() + 5

def pump():
    global buf
    ready, _, _ = select.select([master], [], [], 0.1)
    if not ready:
        return
    try:
        chunk = os.read(master, 8192)
    except OSError:
        return
    buf += chunk

code = None
while time.time() < deadline and b"docsearch" not in buf and b"\x1b[?1049h" not in buf:
    pump()
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        code = os.waitstatus_to_exitcode(status)
        break
if code is None:
    try:
        if mode == "int":
            os.write(master, b"/help\r")
            time.sleep(0.2)
            os.write(master, b"\x03")
        elif mode == "term":
            os.kill(pid, 15)
        elif mode == "nav":
            os.write(master, b"pty\r")
            time.sleep(0.3)
            for sequence in (b"\x1b[6~", b"\x1b[5~", b" ", b"\r", b"\x1b"):
                os.write(master, sequence)
                time.sleep(0.65 if sequence == b"\x1b" else 0.15)
            os.write(master, b"q")
        else:
            os.write(master, b"\x04")
    except OSError:
        pass
    while time.time() < deadline:
        pump()
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            code = os.waitstatus_to_exitcode(status)
            break
if code is None:
    os.kill(pid, 9)
    sys.stderr.write("TIMEOUT")
    sys.stdout.buffer.write(buf)
    raise SystemExit(1)
sys.stdout.buffer.write(buf)
sys.stderr.write(f"EXIT:{code}")

