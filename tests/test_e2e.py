"""End-to-end tests with Playwright against a real server in fixture mode.

Run: pytest tests/test_e2e.py   (skipped if no Chromium is available)
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
AXE = (ROOT / "tests/vendor/axe.min.js").read_text()

pw = pytest.importorskip("playwright.sync_api")
from browser import launch  # noqa: E402


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    port = _free_port()
    env = {**os.environ, "APP_MODE": "fixture", "DATA_DIR": str(tmp_path_factory.mktemp("e2e")),
           "FIXTURE_STEP_DELAY": "0", "GEMINI_API_KEY": "", "LIMIT_DOCUMENTS_PER_HOUR": "0"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(f"{url}/api/health").status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    yield url
    proc.terminate()
    proc.wait(5)


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = launch(p)
        except Exception as e:  # no browser available
            pytest.skip(f"Chromium not available: {e}")
        yield b
        b.close()


def spoken(page):
    """Latest text Chart2Music rendered into its live region."""
    return page.evaluate("""() => { const n = document.querySelector('[id$="-cc"]');
      const l = [...n.children].filter(c => c.style.display !== 'none').pop();
      return l ? l.getAttribute('data-original-text') : n.innerText; }""")


def open_sample(page, base, name):
    page.goto(base + "/#/app")
    page.wait_for_selector("button[data-sample]")
    page.click(f'button[data-sample="{name}"]')


def axe(page):
    # Colors mid-transition (a toggle that was just pressed) would be measured half-faded.
    page.add_style_tag(content="*, *::before, *::after { transition: none !important; }")
    page.add_script_tag(content=AXE)
    return page.evaluate("""async () => (await axe.run(document, {runOnly: {type: 'tag',
      values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}})).violations
      .map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '))""")


def test_home_plays_a_graph_right_away(browser, base):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(base + "/")
    page.wait_for_selector(".stage-frame")
    play = page.locator("button.play")
    assert play.is_visible() and play.bounding_box()["y"] + 40 < 900  # above the fold
    play.click()
    xs = []
    for _ in range(4):
        time.sleep(0.4)
        xs.append(float(page.get_attribute(".playhead-line", "x1")))
    assert xs == sorted(xs) and xs[-1] > xs[0]  # the playhead sweeps left to right
    assert page.text_content("button.play") == "Pause"
    page.close()


def test_keyboard_exploration_speaks_values(browser, base):
    page = browser.new_page()
    page.goto(base + "/")
    page.wait_for_selector(".stage-frame")
    page.focus(".stage-frame")
    page.keyboard.press("ArrowRight")
    time.sleep(0.4)
    assert spoken(page) == "1, 5.4 mol/s"
    page.keyboard.press("BracketRight")
    time.sleep(0.4)
    assert spoken(page) == "7, 45 mol/s"
    assert "Step 7: 45 mol/s" in page.text_content(".readout")
    page.close()


def test_uncertain_points_are_announced(browser, base):
    page = browser.new_page()
    open_sample(page, base, "phone-photo")  # a tilted photo: every point is uncertain until straightened
    page.wait_for_selector("#view-verify", timeout=20000)
    assert "Shape only" in page.text_content(".trust-callout")
    page.focus(".stage-frame")
    page.keyboard.press("ArrowRight")
    time.sleep(0.4)
    assert spoken(page).endswith(", uncertain")
    page.close()


def test_sparse_ticks_is_medium_without_uncertain_points(browser, base):
    page = browser.new_page()
    open_sample(page, base, "sparse-ticks")
    page.wait_for_selector("#view-verify", timeout=20000)
    assert "The shape is reliable" in page.text_content(".trust-callout")
    assert "Every point passed its checks, but" in page.text_content(".confidence-panel")
    page.focus(".stage-frame")
    page.keyboard.press("ArrowRight")
    time.sleep(0.4)
    assert not spoken(page).endswith(", uncertain")
    page.close()


def test_sample_pdf_lists_four_charts(browser, base):
    page = browser.new_page()
    open_sample(page, base, "lecture")
    page.wait_for_selector("#chart-list li", timeout=20000)
    items = page.locator("#chart-list li .title").all_text_contents()
    assert [i.split(",")[0] for i in items] == ["Page 2", "Page 4", "Page 5", "Page 5"]
    assert page.text_content("#empty-pages") == "No charts on pages 1, 3, and 6."
    page.close()


def test_playing_says_what_the_notes_stand_for(browser, base):
    page = browser.new_page()
    # An axis from about 49 to 73: the pitch range is stated, with a warning that it is not zero-based.
    open_sample(page, base, "two-lines")
    page.wait_for_selector("#summary-text", timeout=20000)
    assert "not zero" in page.text_content("#baseline-note")
    page.click("button.play")
    page.wait_for_function("document.querySelector('#announcer').textContent.startsWith('Playing')")
    said = page.text_content("#announcer")
    assert "Low notes are 4" in said and "high notes are 7" in said and "%" in said
    assert "not zero, so changes sound bigger than they are" in said
    time.sleep(0.6)  # let the playhead move, so play continues instead of starting over
    page.click("button.play")  # pause
    page.wait_for_function("document.querySelector('#announcer').textContent === 'Paused.'")
    page.click("button.play")  # resume: no repetition
    page.wait_for_function("document.querySelector('#announcer').textContent === 'Resuming.'")
    page.click("#read-summary")
    page.wait_for_function("document.querySelector('#announcer').textContent.includes('not zero')")
    # An axis that starts near zero: the range is stated, no warning.
    open_sample(page, base, "clean-line")
    page.wait_for_selector("#summary-text", timeout=20000)
    assert page.query_selector("#baseline-note") is None
    page.click("button.play")
    page.wait_for_function("document.querySelector('#announcer').textContent.startsWith('Playing')")
    said = page.text_content("#announcer")
    assert "Low notes are" in said and "mol/s" in said and "not zero" not in said
    page.close()


def playhead_x(page):
    return float(page.get_attribute(".playhead-line", "x1") or 0)


def test_keyboard_play_waits_for_the_introduction(browser, base):
    page = browser.new_page()
    open_sample(page, base, "clean-line")
    page.wait_for_selector("#summary-text", timeout=20000)
    page.focus("button.play")
    page.keyboard.press("Enter")  # a screen reader user: the introduction is said before the sound
    page.wait_for_function("document.querySelector('#announcer').textContent.startsWith('Playing')")
    assert page.text_content("button.play") == "Start now"
    x0 = playhead_x(page)
    time.sleep(1.0)
    assert playhead_x(page) == x0  # silent while the introduction is being said
    page.keyboard.press("Enter")  # Start now: skip the rest of the wait
    page.wait_for_function("document.querySelector('button.play').textContent === 'Pause'", timeout=2000)
    time.sleep(0.6)
    assert playhead_x(page) > x0
    page.keyboard.press("Enter")  # pause
    page.wait_for_function("document.querySelector('button.play').textContent === 'Play graph'")
    # Without skipping, the sound starts by itself after the estimated speaking time.
    open_sample(page, base, "bars")
    page.wait_for_selector("#summary-text", timeout=20000)
    page.focus("button.play")
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelector('button.play').textContent === 'Start now'")
    page.wait_for_function("document.querySelector('button.play').textContent === 'Pause'", timeout=12000)
    page.close()


def test_built_in_voice_finishes_before_the_sound_starts(browser, base):
    page = browser.new_page()
    # Stand-in voice: records what was spoken and finishes each utterance 400 ms later.
    page.add_init_script("""
      localStorage.setItem('voice', 'on');
      window.__said = [];
      const synth = { speaking: false, cancel() {}, getVoices: () => [],
        speak(u) { window.__said.push({ text: u.text, at: performance.now() }); setTimeout(() => { u.onend?.(); window.__said.at(-1).end = performance.now(); }, 400); } };
      Object.defineProperty(window, 'speechSynthesis', { value: synth });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    """)
    open_sample(page, base, "clean-line")
    page.wait_for_selector("#summary-text", timeout=20000)
    page.click("button.play")  # even a mouse click waits when the app itself is speaking
    page.wait_for_function("window.__said.some(s => s.text.startsWith('Playing'))")
    assert page.text_content("button.play") == "Start now"
    page.wait_for_function("document.querySelector('button.play').textContent === 'Pause'", timeout=3000)
    page.close()


def test_question_is_answered_from_data(browser, base):
    page = browser.new_page()
    open_sample(page, base, "two-lines")
    page.wait_for_selector("#ask-form", timeout=20000)
    page.fill("#question", "which program is higher in 2020?")
    page.keyboard.press("Enter")
    page.wait_for_selector(".answers li")
    assert "Program B is higher by 4.8 percentage points" in page.text_content(".answers li .a")
    page.close()


# A stand-in for the browser's speech recognition: says window.__speech.text (interim first,
# then final), or fails with window.__speech.error. Records how often it was started.
FAKE_SPEECH = """
window.__speech = { text: "what is the rate at step seven", error: "", starts: 0, stall: false, stopped: false };
window.webkitSpeechRecognition = class {
  start() {
    window.__speech.starts++;
    const s = window.__speech, res = (t, fin) => Object.assign([{ transcript: t }], { isFinal: fin });
    this.onstart?.();
    setTimeout(() => {
      this.onaudiostart?.();
      if (s.error) { this.onerror?.({ error: s.error }); this.onend?.(); return; }
      const half = s.text.split(" ").slice(0, 3).join(" ");
      this.onresult?.({ results: [res(half, false)] });
      // stall: the full text arrives as interim and the recognizer never finishes on its own
      if (s.stall) { setTimeout(() => this.onresult?.({ results: [res(s.text, false)] }), 100); return; }
      setTimeout(() => { this.onresult?.({ results: [res(s.text, true)] }); this.onend?.(); }, 150);
    }, 50);
  }
  stop() { if (window.__speech.stall) { window.__speech.stopped = true; this.onresult?.({ results: [] }); this.onend?.(); } }
  abort() { this.onerror?.({ error: "aborted" }); this.onend?.(); }
};
window.SpeechRecognition = window.webkitSpeechRecognition;
"""


def announced(page):
    return page.text_content("#announcer") + " " + page.text_content("#announcer-assertive")


def test_question_asked_by_voice(browser, base):
    page = browser.new_page()
    page.add_init_script(FAKE_SPEECH)
    open_sample(page, base, "clean-line")
    page.wait_for_selector("#ask-voice", state="visible", timeout=20000)
    assert page.is_visible("#voice-help")
    page.click("#ask-voice")
    page.wait_for_selector(".answers li")
    # Spoken numbers reach the calculation, and the heard question is repeated before the answer.
    assert page.text_content(".answers li .q") == "You asked: what is the rate at step seven"
    assert "45 mol/s" in page.text_content(".answers li .a")
    page.wait_for_function("document.querySelector('#announcer').textContent.startsWith('You asked: what is the rate')")
    assert "45 mol/s" in page.text_content("#announcer")
    assert page.text_content("#ask-voice") == "Ask by voice" and not page.is_visible("#voice-status")
    # A recognizer that stalls without a final result is stopped after a quiet pause, and what
    # it heard is still asked.
    page.evaluate("window.__speech.stall = true; window.__speech.text = 'what is the rate at step six'")
    page.click("#ask-voice")
    page.wait_for_function("document.querySelectorAll('.answers li').length === 2", timeout=8000)
    assert page.evaluate("window.__speech.stopped")
    assert page.text_content(".answers li .q") == "You asked: what is the rate at step six"
    assert "40.3 mol/s" in page.text_content(".answers li .a")
    page.close()


def test_voice_shortcut_on_the_chart_and_microphone_errors(browser, base):
    page = browser.new_page()
    page.add_init_script(FAKE_SPEECH)
    open_sample(page, base, "clean-line")
    page.wait_for_selector("#ask-voice", state="visible", timeout=20000)
    page.evaluate("window.__speech.error = 'not-allowed'")
    page.focus("[id$='-stage']")
    page.keyboard.press("v")
    page.wait_for_function("window.__speech.starts === 1")
    page.wait_for_function("document.querySelector('#voice-status').textContent.includes('microphone is blocked')")
    assert page.is_visible("#voice-status")
    page.wait_for_function("document.querySelector('#announcer-assertive').textContent.includes('microphone is blocked')")
    page.evaluate("window.__speech.error = 'no-speech'")
    page.click("#ask-voice")
    page.wait_for_function("document.querySelector('#voice-status').textContent.includes(\"didn't hear\")")
    assert page.query_selector_all(".answers li") == []
    page.close()


def test_voice_button_hidden_without_speech_recognition(browser, base):
    page = browser.new_page()
    page.add_init_script("delete window.webkitSpeechRecognition; delete window.SpeechRecognition;")
    open_sample(page, base, "clean-line")
    page.wait_for_selector("#ask-form", timeout=20000)
    assert not page.is_visible("#ask-voice") and not page.is_visible("#voice-help")
    assert page.get_attribute("#voice-shortcut", "hidden") is not None
    page.close()


def test_verification_view_marks_every_point(browser, base):
    page = browser.new_page()
    open_sample(page, base, "phone-photo")
    page.wait_for_selector("#view-verify", timeout=20000)
    page.click("#view-verify")
    assert page.locator(".marks .mark").count() == 22
    assert page.locator(".marks .mark.low").count() == 22  # tilted photo: every point uncertain
    assert "Reading it again needs live mode" in page.text_content("#verify-extra")
    page.close()


def test_landing_explains_then_links_to_the_app(browser, base):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(base + "/")
    page.wait_for_selector(".hero .stage-frame")
    assert page.text_content("h1") == "Hear every graph in your lecture slides."
    for section in ("how-it-works", "features", "trust", "accessibility", "faq"):
        assert page.locator(f"#{section}").count() == 1
    page.click("a.landing-only")  # header "Open the app"
    page.wait_for_selector("button[data-sample]")
    assert page.evaluate("location.hash") == "#/app"
    assert page.text_content("h1") == "Open a chart"
    page.close()


def test_eyes_closed_mode_blanks_and_reveals(browser, base):
    page = browser.new_page()
    page.goto(base + "/#/app")
    page.wait_for_selector(".stage-frame")
    page.click(".eyes-btn")
    assert page.locator(".eyes-closed").is_visible()
    assert page.evaluate("document.querySelector('main').inert")
    page.keyboard.press("Escape")
    assert page.locator(".eyes-closed").count() == 0
    assert not page.evaluate("document.querySelector('main').inert")
    page.close()


def test_delete_my_files(browser, base):
    page = browser.new_page()
    open_sample(page, base, "bars")
    page.wait_for_selector("#view-verify", timeout=20000)
    doc = page.url.split("/chart/")[1].rsplit("-c", 1)[0]
    page.goto(f"{base}/#/doc/{doc}")
    page.wait_for_selector("#delete-doc")
    page.click("#delete-doc")
    page.wait_for_function("document.querySelector('#delete-status').textContent.length > 0")
    assert httpx.get(f"{base}/api/documents/{doc}").status_code == 404
    page.close()


@pytest.mark.parametrize("scheme,width", [("light", 1280), ("dark", 1280), ("light", 390), ("dark", 390)])
def test_no_axe_violations(browser, base, scheme, width):
    page = browser.new_page(viewport={"width": width, "height": 900}, color_scheme=scheme)
    page.goto(base + "/")
    page.wait_for_selector(".hero .stage-frame")
    page.add_style_tag(content=".reveal { transition: none !important; }")
    page.evaluate("document.querySelectorAll('.reveal').forEach(n => n.classList.add('in'))")
    assert axe(page) == []
    page.goto(base + "/#/app")
    page.wait_for_selector("button[data-sample]")
    assert axe(page) == []
    page.click('button[data-sample="two-lines"]')
    page.wait_for_selector("#view-verify", timeout=20000)
    assert axe(page) == []
    page.click("#view-verify")
    assert axe(page) == []
    page.goto(base + "/#/app")
    page.wait_for_selector("button[data-sample]")
    page.click('button[data-sample="lecture"]')
    page.wait_for_selector("#chart-list li", timeout=20000)
    assert axe(page) == []
    page.close()


@pytest.mark.parametrize("width", [320, 390])
def test_no_horizontal_scroll_on_phones(browser, base, width):
    page = browser.new_page(viewport={"width": width, "height": 800})
    open_sample(page, base, "two-lines")
    page.wait_for_selector("#view-verify", timeout=20000)
    page.click("#view-verify")
    assert page.evaluate("document.documentElement.scrollWidth") <= width
    page.close()
