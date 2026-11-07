#!/usr/bin/env python3
"""
Takes a screenshot of the running app with a real browser.

    python3 tools/screenshot.py http://localhost:8477/index.html \
        --out docs/screenshot-home.png --delay 2.5

Firefox's own --screenshot flag captures the page at the load event. That is
too early for this app: the word sets are fetched asynchronously, so the cards
are not on the page yet and the capture comes out empty. Marionette (the
protocol Firefox already speaks for automation) lets us wait first and then
capture whatever is really on screen.

No extra packages are needed - it talks to Firefox over its built-in
Marionette socket.
"""

import argparse
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

MARIONETTE_PORT = 2828
FIREFOX = shutil.which("firefox") or shutil.which("firefox-esr")


# --- Marionette wire protocol ----------------------------------------------
# Messages are JSON, length prefixed:  <byte-length>:<json>


def read_packet(sock):
    length = b""
    while True:
        char = sock.recv(1)
        if not char:
            raise ConnectionError("Marionette closed the connection")
        if char == b":":
            break
        length += char

    payload = b""
    while len(payload) < int(length):
        chunk = sock.recv(int(length) - len(payload))
        if not chunk:
            raise ConnectionError("Marionette closed the connection")
        payload += chunk

    return json.loads(payload.decode("utf8"))


def send_packet(sock, message):
    data = json.dumps(message).encode("utf8")
    sock.sendall(str(len(data)).encode("ascii") + b":" + data)


class Session:
    def __init__(self, sock):
        self.sock = sock
        self.next_id = 0
        read_packet(sock)  # the handshake packet

    def command(self, name, params=None):
        self.next_id += 1
        message_id = self.next_id
        send_packet(self.sock, [0, message_id, name, params or {}])

        while True:
            response = read_packet(self.sock)
            # type 1 = command reply, type 4 = an event we do not care about
            if not isinstance(response, list) or len(response) != 4:
                continue
            if response[0] != 1 or response[1] != message_id:
                continue
            if response[2]:
                raise RuntimeError(f"{name} failed: {response[2]}")
            return response[3]

    def navigate(self, url):
        self.command("WebDriver:Navigate", {"url": url})

    def run_script(self, script, args=None):
        result = self.command(
            "WebDriver:ExecuteScript",
            {"script": script, "args": args or [], "newSandbox": False},
        )
        return result.get("value") if isinstance(result, dict) else result

    def screenshot(self):
        result = self.command("WebDriver:TakeScreenshot", {"full": False, "hash": False})
        if isinstance(result, dict):
            return base64.b64decode(result["value"])
        return base64.b64decode(result)


def wait_for_port(port, process, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Firefox exited before Marionette came up")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return
        except OSError:
            time.sleep(0.3)
    raise RuntimeError(f"Marionette did not open port {port} in time")


def capture(url, out_path, delay, width, height, profile, dark=False, click=None):
    if dark:
        # Firefox reports the system theme through this pref. The app follows
        # prefers-color-scheme, so this is what puts it into dark mode.
        with open(os.path.join(profile, "user.js"), "w", encoding="utf8") as handle:
            handle.write('user_pref("ui.systemUsesDarkTheme", 1);\n')

    process = subprocess.Popen(
        [
            FIREFOX,
            "--headless",
            "--marionette",
            "--no-remote",
            "--profile",
            profile,
            "--window-size",
            f"{width},{height}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        wait_for_port(MARIONETTE_PORT, process)
        sock = socket.create_connection(("127.0.0.1", MARIONETTE_PORT), timeout=60)
        sock.settimeout(60)
        session = Session(sock)

        # Marionette refuses WebDriver commands until a session exists.
        session.command("WebDriver:NewSession", {"capabilities": {}})
        session.command(
            "WebDriver:SetWindowRect", {"width": width, "height": height, "x": 0, "y": 0}
        )
        session.navigate(url)
        time.sleep(delay)

        if click:
            # open whatever the shot should show (a modal, a flipped card)
            session.run_script(
                "var el = document.querySelector(arguments[0]);"
                "if (el) el.click();",
                [click],
            )
            time.sleep(1.0)

        # Report what is actually on the page, so a capture of an empty view
        # cannot be mistaken for a working one.
        summary = session.run_script(
            "return {cards: document.querySelectorAll('.card').length,"
            " sets: document.querySelectorAll('.set-card').length,"
            " kofi: !!document.querySelector('#kofiWidget .kofi-button'),"
            " title: document.title};"
        )
        image = session.screenshot()
        sock.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as handle:
        handle.write(image)

    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="the page to capture")
    parser.add_argument("--out", default="screenshot.png", help="where to write the PNG")
    parser.add_argument(
        "--delay", type=float, default=2.5, help="seconds to wait before capturing"
    )
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument(
        "--dark", action="store_true", help="render with the dark colour scheme"
    )
    parser.add_argument(
        "--click",
        default=None,
        help="CSS selector to click before capturing (e.g. '#statsBtn')",
    )
    args = parser.parse_args()

    if not FIREFOX:
        print("Firefox is not installed", file=sys.stderr)
        return 1

    profile = tempfile.mkdtemp(prefix="mw-shot-")
    try:
        summary = capture(
            args.url,
            args.out,
            args.delay,
            args.width,
            args.height,
            profile,
            dark=args.dark,
            click=args.click,
        )
    except Exception as err:  # noqa: BLE001 - report and fail cleanly
        print(f"screenshot failed: {err}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    print(f"wrote {args.out}")
    print(
        "page: {cards} card(s), {sets} set card(s), kofi button: {kofi}".format(
            cards=summary.get("cards"),
            sets=summary.get("sets"),
            kofi=summary.get("kofi"),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
