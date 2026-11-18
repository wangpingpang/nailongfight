"""Exercise the served and portable builds through visible Chromium UI."""
from contextlib import contextmanager
from pathlib import Path
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "src/game/data/game.json").read_text(encoding="utf-8"))
COPY = CONFIG["uiText"]
FIGHTERS = json.loads((ROOT / "src/game/data" / CONFIG["fighterModule"]).read_text(encoding="utf-8"))
INITIAL_FIGHTER = FIGHTERS["characters"][FIGHTERS["roster"][0]]
EVIDENCE = ROOT / "production/qa/evidence"
PORT = 4177
ORIGIN = f"http://127.0.0.1:{PORT}"
ACTION_KEYS = (["J", "K", "L", "U", "I"], ["1", "2", "3", "4", "5"])


@contextmanager
def server():
    proc = subprocess.Popen(["node", "scripts/game-server.mjs"], cwd=ROOT,
                            env={**os.environ, "PORT": str(PORT)})
    try:
        for _ in range(50):
            try:
                with urllib.request.urlopen(ORIGIN, timeout=1):
                    break
            except OSError:
                if proc.poll() is not None:
                    raise RuntimeError("Game server stopped during startup")
                time.sleep(0.1)
        else:
            raise RuntimeError("The game server did not become ready")
        yield
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def capture(page, name):
    page.screenshot(path=EVIDENCE / (name + ".png"), animations="disabled")


def click(page, text):
    page.get_by_role("button", name=text, exact=True).click(timeout=8000)


def check_key_settings(page):
    def player_one_skill(key):
        return page.get_by_role("button", name=f"玩家 1 技能一 {key}", exact=True)

    click(page, "设置")
    expect(player_one_skill("K")).to_be_visible()
    expect(page.get_by_role("button", name="玩家 2 普攻 1", exact=True)).to_be_visible()
    player_one_skill("K").click()
    page.keyboard.press("Numpad2")
    expect(page.locator(".errorline")).to_contain_text(re.compile("占用|已有动作"))
    player_one_skill("K").click()
    page.keyboard.press("b")
    click(page, "保存设置")
    expect(page.get_by_role("dialog", name="操作设置")).to_have_count(0)
    page.reload()
    click(page, "设置")
    expect(player_one_skill("B")).to_be_visible()
    click(page, "恢复默认键位")
    expect(player_one_skill("K")).to_be_visible()
    click(page, "保存设置")
    expect(page.get_by_role("dialog", name="操作设置")).to_have_count(0)


def enter_local_duel(page):
    page.get_by_role("button", name=COPY["pvp"], exact=False).click()
    expect(page.get_by_role("button", name="开始双人对战")).to_be_disabled()
    for slot, movement in enumerate((["W", "A", "S", "D"], ["↑", "↓", "←", "→"])):
        help_panel = page.locator(".keyhelp").nth(slot)
        spare = ["O", "6"][slot]
        expect(help_panel.locator("kbd")).to_have_text(movement + ACTION_KEYS[slot] + [spare])
        expect(help_panel).to_contain_text("预留")
    expect(page.locator(".keyhelp").nth(1)).to_contain_text("小键盘")
    click(page, "玩家 1 就绪")
    click(page, "玩家 2 就绪")
    click(page, "开始双人对战")
    expect(page.locator("canvas")).to_be_visible()
    for slot, keys in enumerate(ACTION_KEYS):
        expect(page.locator(".skill-strip").nth(slot).locator(".hud-skill kbd")).to_have_text(keys)


def action_cell(page, slot, key):
    return page.locator(".skill-strip").nth(slot).locator(".hud-skill").filter(
        has=page.get_by_text(key, exact=True)
    )


def check_cooldown(page, slot, key):
    cell = action_cell(page, slot, key)
    expect(cell).to_have_attribute("data-ready", "false")
    expect(cell.locator("small")).to_have_text(re.compile(r"^[1-9]\d*s$"))


def simultaneous_keys(page, first, second):
    page.keyboard.down(first)
    page.keyboard.down(second)
    page.clock.run_for(35)
    page.keyboard.up(first)
    page.keyboard.up(second)


def smoke(browser):
    ctx = browser.new_context(viewport={"width": 1366, "height": 850}, locale="zh-CN",
                              device_scale_factor=1, reduced_motion="reduce")
    page = ctx.new_page()
    failures = []
    page.on("pageerror", lambda err: failures.append(str(err)))
    # Install before navigation so the very first animation frame uses this clock.
    page.clock.install()
    page.goto(ORIGIN)
    expect(page.get_by_role("button", name=COPY["heroAction"], exact=True)).to_be_visible()
    expect(page.locator(".hero-img")).to_have_js_property("complete", True)
    assert page.locator(".hero-img").evaluate("img=>img.naturalWidth > 0")
    check_key_settings(page)
    capture(page, "lobby")
    click(page, COPY["characters"])
    capture(page, "fighters")
    click(page, COPY["stages"])
    expect(page.locator(".stage-card:disabled")).to_have_count(len(CONFIG["stages"]) - 1)
    capture(page, "stages")
    click(page, COPY["home"])
    click(page, COPY["heroAction"])
    choices = page.locator(".pick-grid .fighter")
    expect(choices).to_have_count(len(FIGHTERS["roster"]))
    for fighter_id in FIGHTERS["roster"]:
        expect(choices.filter(has_text=FIGHTERS["characters"][fighter_id]["name"])).to_have_count(1)
    scenes = page.locator(".scene-option")
    expect(scenes).to_have_count(len(CONFIG["scenes"]))
    scenes.filter(has_text="雨拍站前").click()
    capture(page, "select")
    click(page, "开始人机对战")
    expect(page.locator("canvas")).to_be_visible()
    expect(page.locator("canvas")).to_have_attribute("aria-label", re.compile("雨拍站前"))
    page.clock.run_for(350)
    capture(page, "battle")
    page.keyboard.down("d")
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    expect(page.get_by_role("dialog", name="对局已暂停")).to_be_visible()
    frozen = page.locator(".clock b").inner_text()
    page.clock.run_for(1800)
    assert page.locator(".clock b").inner_text() == frozen
    page.keyboard.up("d")
    click(page, "继续对局")
    page.clock.run_for(CONFIG["rules"]["resumeSeconds"] * 1000 + 100)
    expect(page.get_by_role("dialog")).to_have_count(0)
    # One render callback consumes all elapsed fixed simulation ticks. Advancing
    # once per chunk avoids drawing thousands of frames just to reach the verdict.
    limit_ms = math.ceil(CONFIG["rules"]["duelLimit"] * 1000 / CONFIG["rules"]["tickRate"])
    for _ in range(math.ceil(limit_ms / 5000) + 1):
        if page.get_by_role("button", name="再来一局", exact=True).count():
            break
        page.clock.fast_forward(5000)
    expect(page.get_by_role("button", name="再来一局")).to_be_visible()
    capture(page, "match-result")
    click(page, "再来一局")
    expect(page.locator("canvas")).to_be_visible()
    expect(page.locator("canvas")).to_have_attribute("aria-label", re.compile("雨拍站前"))
    base_hp = INITIAL_FIGHTER["hp"]
    expect(page.locator(".vitals .hud-name small").first).to_have_text(f"{base_hp} / {base_hp}")
    page.keyboard.press("Escape")
    click(page, "退出到大厅")

    enter_local_duel(page)
    page.keyboard.down("a")
    page.keyboard.down("ArrowRight")
    page.clock.run_for(550)
    page.keyboard.up("a")
    page.keyboard.up("ArrowRight")
    simultaneous_keys(page, "k", "Digit2")
    check_cooldown(page, 0, "K")
    check_cooldown(page, 1, "2")
    page.clock.run_for(900)
    page.keyboard.press("Numpad3")
    page.clock.run_for(40)
    check_cooldown(page, 1, "3")
    expect(action_cell(page, 0, "L")).to_have_attribute("data-ready", "true")
    page.keyboard.press("l")
    page.clock.run_for(40)
    check_cooldown(page, 0, "L")
    page.keyboard.press("Escape")
    click(page, "退出到大厅")
    page.set_viewport_size({"width": 410, "height": 850})
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    capture(page, "narrow-lobby")
    assert not failures, failures
    ctx.close()


def portable(browser):
    ctx = browser.new_context(viewport={"width": 1366, "height": 850}, offline=True)
    page = ctx.new_page()
    page.clock.install()
    errors, external = [], []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("request", lambda req: external.append(req.url) if req.url.startswith(("http:", "https:")) else None)
    page.goto((ROOT / "dist/echo-arena.html").as_uri())
    click(page, COPY["heroAction"])
    click(page, "开始人机对战")
    expect(page.locator("canvas")).to_be_visible()
    expect(page.locator(".hud-name b").first).to_have_text(INITIAL_FIGHTER["name"])
    expect(page.locator(".clock b")).not_to_have_text("")
    page.keyboard.press("Escape")
    click(page, "退出到大厅")
    enter_local_duel(page)
    simultaneous_keys(page, "u", "Numpad4")
    check_cooldown(page, 0, "U")
    check_cooldown(page, 1, "4")
    assert not errors and not external, (errors, external)
    ctx.close()


if __name__ == "__main__":
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    chrome = shutil.which("google-chrome") or shutil.which("chromium")
    with server(), sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        smoke(browser)
        portable(browser)
        browser.close()
    print("Passed served-game browser flow, desktop/narrow screenshots and offline startup.")
