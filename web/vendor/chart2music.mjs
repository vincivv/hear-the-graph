var AudioNotificationType;
(function (AudioNotificationType) {
    AudioNotificationType["Annotation"] = "Annotation";
})(AudioNotificationType || (AudioNotificationType = {}));

const C3 = 130.8128;
const G3 = 195.9977;
const C4 = C3 * 2;
const G4 = G3 * 2;
const G5 = G4 * 2;
class OscillatorAudioEngine {
    constructor(context) {
        this._audioContext = context;
        this._masterCompressor = context.createDynamicsCompressor();
        this._masterCompressor.connect(this._audioContext.destination);
        this._masterCompressor.threshold.value = -50;
        this._masterCompressor.knee.value = 40;
        this._masterCompressor.ratio.value = 12;
        this._masterCompressor.attack.value = 0;
        this._masterCompressor.release.value = 0.25;
        this._masterGain = this._audioContext.createGain();
        this._masterGain.gain.value = 0.5;
        this._masterCompressor.connect(this._masterGain);
        this._masterGain.connect(this._audioContext.destination);
    }
    get masterGain() {
        return this._masterGain.gain.value;
    }
    set masterGain(value) {
        this._masterGain.gain.value = value;
    }
    playDataPoint(frequency, panning, duration = 0.2) {
        this._playDataPoint(frequency, panning, duration, this._masterCompressor);
    }
    playNotification(notificationType, panning = 0, duration = 0.15) {
        if (notificationType === AudioNotificationType.Annotation) {
            this._playAnnotation(panning, duration);
        }
    }
    _playDataPoint(frequency, panning, duration, destinationNode) {
        const t = this._audioContext.currentTime;
        const mainFreq = this._audioContext.createOscillator();
        mainFreq.frequency.value = frequency;
        mainFreq.start();
        const { carrier: c1, amp: a1, modulator: m1, filter: f1, adsr: adsr1 } = createOperator(this._audioContext, frequency * 0.5, frequency * 3, frequency * 2);
        c1.type = "triangle";
        adsr1.gain.setValueCurveAtTime([0.2, 0.1], t, duration * 0.75);
        f1.frequency.value = frequency;
        f1.type = "lowpass";
        const adsr = this._audioContext.createGain();
        adsr.gain.setValueCurveAtTime([0.5, 1, 0.5, 0.5, 0.5, 0.1, 0.0001], t, duration);
        const panner = this._audioContext.createStereoPanner();
        panner.pan.value = panning;
        mainFreq.connect(adsr);
        adsr1.connect(adsr);
        adsr.connect(panner);
        panner.connect(destinationNode);
        setTimeout(() => {
            panner.disconnect();
            adsr.disconnect();
            adsr1.disconnect();
            mainFreq.stop();
            mainFreq.disconnect();
            m1.stop();
            m1.disconnect();
            c1.stop();
            c1.disconnect();
            a1.disconnect();
            f1.disconnect();
        }, duration * 1000 * 2);
    }
    _playAnnotation(panning, duration) {
        const panner = this._audioContext.createStereoPanner();
        panner.pan.value = panning;
        const gain = this._audioContext.createGain();
        gain.gain.value = 0.5;
        gain.connect(panner);
        panner.connect(this._masterCompressor);
        this._playDataPoint(C3, 0, duration / 4, gain);
        this._playDataPoint(C4, 0, duration / 4, gain);
        setTimeout(() => {
            this._playDataPoint(G3, 0, duration / 4, gain);
            this._playDataPoint(G4, 0, duration / 4, gain);
            this._playDataPoint(G5, 0, duration / 4, gain);
        }, duration * 1000 * 0.25);
        setTimeout(() => {
            this._playDataPoint(C3, 0, duration / 4, gain);
            this._playDataPoint(C4, 0, duration / 4, gain);
        }, duration * 1000 * 0.5);
        setTimeout(() => {
            this._playDataPoint(G3, 0, duration / 4, gain);
            this._playDataPoint(G4, 0, duration / 4, gain);
            this._playDataPoint(G5, 0, duration / 4, gain);
        }, duration * 1000 * 0.75);
        setTimeout(() => {
            gain.disconnect();
        }, duration * 1000 * 2);
    }
}
function createOperator(context, carrierFrequency, modulatorFrequency, modulatorDepth) {
    const c = context.createOscillator();
    const a = context.createGain();
    const m = context.createOscillator();
    const f = context.createBiquadFilter();
    const adsr = context.createGain();
    c.frequency.value = carrierFrequency;
    m.frequency.value = modulatorFrequency;
    a.gain.value = modulatorDepth;
    m.connect(a);
    a.connect(c.frequency);
    c.connect(f);
    f.connect(adsr);
    c.start();
    m.start();
    return { carrier: c, amp: a, modulator: m, filter: f, adsr: adsr };
}

const HERTZ = [
    16.3516, 17.32391, 18.35405, 19.44544, 20.60172, 21.82676, 23.12465, 24.49971, 25.95654, 27.5, 29.13524, 30.86771,
    32.7032, 34.64783, 36.7081, 38.89087, 41.20344, 43.65353, 46.2493, 48.99943, 51.91309, 55, 58.27047, 61.73541,
    65.40639, 69.29566, 73.41619, 77.78175, 82.40689, 87.30706, 92.49861, 97.99886, 103.8262, 110, 116.5409, 123.4708,
    130.8128, 138.5913, 146.8324, 155.5635, 164.8138, 174.6141, 184.9972, 195.9977, 207.6523, 220, 233.0819, 246.9417,
    261.6256, 277.1826, 293.6648, 311.127, 329.6276, 349.2282, 369.9944, 391.9954, 415.3047, 440, 466.1638, 493.8833,
    523.2511, 554.3653, 587.3295, 622.254, 659.2551, 698.4565, 739.9888, 783.9909, 830.6094, 880, 932.3275, 987.7666,
    1046.502, 1108.731, 1174.659, 1244.508, 1318.51, 1396.913, 1479.978, 1567.982, 1661.219, 1760, 1864.655, 1975.533,
    2093.005, 2217.461, 2349.318, 2489.016, 2637.02, 2793.826, 2959.955, 3135.963, 3322.438, 3520, 3729.31, 3951.066,
    4186.009, 4434.922, 4698.636, 4978.032, 5274.041, 5587.652, 5919.911, 6271.927, 6644.875, 7040, 7458.62, 7902.133,
];
const SPEEDS = [1000, 250, 100, 50, 25];
const NOTE_LENGTH = 0.25;

const keyboardEventToString = (e) => {
    return `${e.altKey ? "Alt+" : ""}${e.ctrlKey ? "Ctrl+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}`;
};
class KeyboardEventManager {
    constructor(target, modifyHelpDialogText, modifyHelpDialogKeyboardListing) {
        this.modifyHelpDialogText = modifyHelpDialogText;
        this.modifyHelpDialogKeyboardListing = modifyHelpDialogKeyboardListing;
        this._handler = (event) => {
            this._handleKeyEvents(event);
        };
        this._keyMap = {};
        this._target = target;
        this._target.addEventListener("keydown", this._handler);
        if (!this._target.hasAttribute("tabIndex")) {
            this._target.setAttribute("tabIndex", "0");
        }
        this._dialog = null;
    }
    cleanup() {
        this._target.removeEventListener("keydown", this._handler);
        if (this._dialog !== null) {
            document.body.removeChild(this._dialog);
        }
    }
    _handleKeyEvents(event) {
        const keyPress = keyboardEventToString(event);
        if (keyPress in this._keyMap) {
            this._keyMap[keyPress].callback();
            event.preventDefault();
        }
        else if (keyPress.toUpperCase() in this._keyMap) {
            this._keyMap[keyPress.toUpperCase()].callback();
            event.preventDefault();
        }
    }
    registerKeyEvent({ key, callback, title = "", description = "", force = false, keyDescription, caseSensitive = true, order = 100 }) {
        const checkKey = caseSensitive ? key : key.toUpperCase();
        if (!force && checkKey in this._keyMap) {
            return;
        }
        this._keyMap[checkKey] = {
            title,
            description,
            callback,
            keyDescription,
            order
        };
    }
    registerKeyEvents(keyRegistrationList) {
        keyRegistrationList.forEach((kr, order) => {
            this.registerKeyEvent({ order, ...kr });
        });
    }
    generateHelpDialog(lang, translationCallback, keyboardListing) {
        const dialog = document.createElement("dialog");
        dialog.classList.add("chart2music-dialog");
        dialog.classList.add("chart2music-help-dialog");
        dialog.setAttribute("lang", lang);
        const closeButton = document.createElement("button");
        closeButton.textContent = "X";
        closeButton.ariaLabel = translationCallback("close");
        closeButton.style.position = "absolute";
        closeButton.style.top = "10px";
        closeButton.style.right = "10px";
        closeButton.addEventListener("click", () => {
            dialog.close();
        });
        dialog.appendChild(closeButton);
        const heading = translationCallback("kbmg-title");
        const h1 = document.createElement("h1");
        h1.textContent = heading;
        dialog.setAttribute("aria-live", heading);
        dialog.appendChild(h1);
        const frontMatter = document.createElement("p");
        frontMatter.textContent = this.modifyHelpDialogText(lang, translationCallback("help-dialog-front-matter"));
        dialog.appendChild(frontMatter);
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const tr1 = document.createElement("tr");
        (keyboardListing.at(0) ?? []).forEach((txt) => {
            const th = document.createElement("th");
            th.setAttribute("scope", "col");
            th.textContent = txt;
            tr1.appendChild(th);
        });
        thead.appendChild(tr1);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        keyboardListing.slice(1).forEach((row) => {
            const tr = document.createElement("tr");
            row.forEach((cell) => {
                const td = document.createElement("td");
                td.textContent = cell;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dialog.appendChild(table);
        const footer = document.createElement("p");
        footer.appendChild(document.createTextNode(translationCallback("help_dialog_footer")));
        const a = document.createElement("a");
        a.setAttribute("href", "https://www.chart2music.com/");
        a.textContent = "www.chart2music.com";
        footer.appendChild(a);
        footer.appendChild(document.createTextNode("."));
        dialog.appendChild(footer);
        return dialog;
    }
    launchHelpDialog(lang, translationCallback) {
        const headings = [
            "Keyboard Shortcut",
            "Description",
            "Common Alternate Keyboard Shortcut"
        ];
        const listing = Object.entries(this._keyMap)
            .sort((left, right) => {
            if (left[1].order < right[1].order) {
                return -1;
            }
            if (left[1].order > right[1].order) {
                return 1;
            }
            return 0;
        })
            .map(([key, { title, keyDescription, description }]) => [
            title,
            keyDescription ?? key,
            description
        ]);
        if (this._dialog === null) {
            this._dialog = this.generateHelpDialog(lang, translationCallback, this.modifyHelpDialogKeyboardListing(lang, headings, listing));
            document.body.appendChild(this._dialog);
        }
        this._dialog.showModal();
        this._dialog.focus();
    }
}

class ScreenReaderBridge {
    static addAriaAttributes(element, ariaLive = "assertive") {
        element.setAttribute("aria-live", ariaLive);
        element.setAttribute("role", "status");
        element.setAttribute("aria-atomic", "true");
        element.setAttribute("aria-relevant", "additions text");
    }
    constructor(captionElement) {
        this._maxNumPaddingCharacters = 3;
        this._numPaddingCharacters = 0;
        this._element = captionElement;
        this._lastCreatedElement = null;
    }
    get lastCreatedElement() {
        return this._lastCreatedElement;
    }
    clear() {
        this._element.textContent = "";
    }
    render(text) {
        const paddedText = this._creatPaddedText(text);
        const divElement = document.createElement("div");
        divElement.textContent = paddedText;
        divElement.setAttribute(ScreenReaderBridge.ORIGINAL_TEXT_ATTRIBUTE, text);
        divElement.setAttribute("data-created", Date.now().toString());
        if (this.lastCreatedElement) {
            this._removeOldElements();
            this.lastCreatedElement.style.display = "none";
        }
        this._element.appendChild(divElement);
        this._lastCreatedElement = divElement;
    }
    _creatPaddedText(text) {
        let padding = "";
        for (let i = 0; i < this._numPaddingCharacters; i++) {
            padding += ScreenReaderBridge.PADDING_CHARACTER;
        }
        this._numPaddingCharacters =
            (this._numPaddingCharacters + 1) % this._maxNumPaddingCharacters;
        return text + padding;
    }
    _removeOldElements() {
        const curTime = Date.now();
        Array.from(this._element.children).forEach((kid) => {
            const time = Number(kid.getAttribute("data-time"));
            if (curTime - time > ScreenReaderBridge.REMOVAL_DELAY) {
                this._element.removeChild(kid);
            }
        });
    }
}
ScreenReaderBridge.PADDING_CHARACTER = "\u00A0";
ScreenReaderBridge.REMOVAL_DELAY = 25;
ScreenReaderBridge.ORIGINAL_TEXT_ATTRIBUTE = "data-original-text";

function isDataPoint(obj) {
    return typeof obj === "object" && "x" in obj;
}
function isSimpleDataPoint(obj) {
    return isDataPoint(obj) && "y" in obj;
}
function isAlternateAxisDataPoint(obj) {
    return isDataPoint(obj) && "y2" in obj;
}
function isHighLowDataPoint(obj) {
    return isDataPoint(obj) && "high" in obj && "low" in obj;
}
function isOHLCDataPoint(obj) {
    return isHighLowDataPoint(obj) && "open" in obj && "close" in obj;
}
function isBoxDataPoint(obj) {
    return (isHighLowDataPoint(obj) && "q1" in obj && "q3" in obj && "median" in obj);
}

const interpolateBin = ({ point, min, max, bins, scale }) => {
    return scale === "linear"
        ? interpolateBinLinear({ point, min, max, bins })
        : interpolateBinLog({
            pointRaw: point,
            minRaw: min,
            maxRaw: max,
            bins
        });
};
const interpolateBinLinear = ({ point, min, max, bins }) => {
    const pct = (point - min) / (max - min);
    return Math.floor(bins * pct);
};
const interpolateBinLog = ({ pointRaw, minRaw, maxRaw, bins }) => {
    const point = Math.log10(pointRaw);
    const min = Math.log10(minRaw);
    const max = Math.log10(maxRaw);
    const pct = (point - min) / (max - min);
    return Math.floor(bins * pct);
};
const calcPan = (pct) => (isNaN(pct) ? 0 : (pct * 2 - 1) * 0.98);
const isNotNull = (tmp) => tmp !== null;
const calculateAxisMinimum = ({ data, prop, filterGroupIndex }) => {
    let dataToProcess = data.flat().filter(isNotNull);
    if (filterGroupIndex >= 0 && filterGroupIndex < data.length) {
        dataToProcess = data.at(filterGroupIndex);
    }
    const values = dataToProcess
        .map((point) => {
        if (isSimpleDataPoint(point)) {
            if (prop === "x" || prop === "y") {
                return point[prop];
            }
        }
        else if (isAlternateAxisDataPoint(point)) {
            if (prop === "x" || prop === "y2") {
                return point[prop];
            }
        }
        else if (isOHLCDataPoint(point)) {
            if (prop === "x") {
                return point.x;
            }
            if (prop === "y") {
                return Math.min(point.high, point.low, point.open, point.close);
            }
        }
        else if (isHighLowDataPoint(point)) {
            if (prop === "x") {
                return point.x;
            }
            if (prop === "y") {
                return Math.min(point.high, point.low);
            }
        }
        return NaN;
    })
        .filter((num) => !isNaN(num));
    if (values.length === 0) {
        return NaN;
    }
    return Math.min(...values);
};
const calculateAxisMaximum = ({ data, prop, filterGroupIndex }) => {
    let dataToProcess = data.flat().filter(isNotNull);
    if (filterGroupIndex >= 0 && filterGroupIndex < data.length) {
        dataToProcess = data.at(filterGroupIndex);
    }
    const values = dataToProcess
        .map((point) => {
        if (isSimpleDataPoint(point)) {
            if (prop === "x" || prop === "y") {
                return point[prop];
            }
        }
        else if (isAlternateAxisDataPoint(point)) {
            if (prop === "x" || prop === "y2") {
                return point[prop];
            }
        }
        else if (isOHLCDataPoint(point)) {
            if (prop === "x") {
                return point.x;
            }
            if (prop === "y") {
                return Math.max(point.high, point.low, point.open, point.close);
            }
        }
        else if (isHighLowDataPoint(point)) {
            if (prop === "x") {
                return point.x;
            }
            if (prop === "y") {
                return Math.max(point.high, point.low);
            }
        }
        return NaN;
    })
        .filter((num) => !isNaN(num));
    if (values.length === 0) {
        return NaN;
    }
    return Math.max(...values);
};
const defaultFormat = (value) => `${value}`;
const generatePointDescription = ({ point, xFormat = defaultFormat, yFormat = defaultFormat, stat, outlierIndex = null, announcePointLabelFirst = false, translationCallback }) => {
    if (isOHLCDataPoint(point)) {
        if (typeof stat !== "undefined") {
            return translationCallback("point-xy", {
                x: xFormat(point.x),
                y: yFormat(point[stat])
            });
        }
        return translationCallback("point-xohlc", {
            x: xFormat(point.x),
            open: yFormat(point.open),
            high: yFormat(point.high),
            low: yFormat(point.low),
            close: yFormat(point.close)
        });
    }
    if (isBoxDataPoint(point) && outlierIndex !== null) {
        return translationCallback("point-outlier", {
            x: xFormat(point.x),
            y: point.outlier.at(outlierIndex),
            index: outlierIndex + 1,
            count: point.outlier.length
        });
    }
    if (isBoxDataPoint(point) || isHighLowDataPoint(point)) {
        if (typeof stat !== "undefined") {
            return translationCallback("point-xy", {
                x: xFormat(point.x),
                y: yFormat(point[stat])
            });
        }
        const { x, high, low } = point;
        const formattedPoint = {
            x: xFormat(x),
            high: yFormat(high),
            low: yFormat(low)
        };
        if ("outlier" in point && point.outlier?.length > 0) {
            return translationCallback("point-xhl-outlier", {
                ...formattedPoint,
                count: point.outlier.length
            });
        }
        return translationCallback("point-xhl", formattedPoint);
    }
    if (isSimpleDataPoint(point)) {
        const details = [xFormat(point.x), yFormat(point.y)];
        if (point.label) {
            if (announcePointLabelFirst) {
                details.unshift(point.label);
            }
            else {
                details.push(point.label);
            }
        }
        return details.join(", ");
    }
    if (isAlternateAxisDataPoint(point)) {
        return translationCallback("point-xy", {
            x: xFormat(point.x),
            y: yFormat(point.y2)
        });
    }
    return "";
};
const usesAxis = ({ data, axisName }) => {
    const firstUseOfAxis = data.filter(isNotNull).find((row) => {
        return row.find((point) => axisName in point);
    });
    return typeof firstUseOfAxis !== "undefined";
};
const calculateMetadataByGroup = (data) => {
    return data.map((row, index) => {
        if (row === null) {
            return {
                index,
                minimumPointIndex: null,
                maximumPointIndex: null,
                minimumValue: NaN,
                maximumValue: NaN,
                tenths: NaN,
                availableStats: [],
                statIndex: -1,
                inputType: null,
                size: 0
            };
        }
        let yValues = [];
        let availableStats = [];
        if (isSimpleDataPoint(row.at(0))) {
            yValues = row.map(({ y }) => y);
        }
        else if (isAlternateAxisDataPoint(row.at(0))) {
            yValues = row.map(({ y2 }) => y2);
        }
        else if (isOHLCDataPoint(row.at(0))) {
            availableStats = ["open", "high", "low", "close"];
        }
        else if (isBoxDataPoint(row.at(0))) {
            availableStats = ["high", "q3", "median", "q1", "low", "outlier"];
        }
        else if (isHighLowDataPoint(row.at(0))) {
            availableStats = ["high", "low"];
        }
        const filteredYValues = yValues.filter((num) => !isNaN(num));
        const [min, max] = filteredYValues.length > 0
            ? [Math.min(...filteredYValues), Math.max(...filteredYValues)]
            : [-1, -1];
        const tenths = Math.round(row.length / 10);
        return {
            index,
            minimumPointIndex: yValues.indexOf(min),
            maximumPointIndex: yValues.indexOf(max),
            minimumValue: min,
            maximumValue: max,
            tenths,
            availableStats,
            statIndex: -1,
            inputType: detectDataPointType(row.at(0)),
            size: row.length
        };
    });
};
const initializeAxis = ({ data, axisName, userAxis, filterGroupIndex }) => {
    const format = userAxis?.format ??
        ("valueLabels" in userAxis
            ? (index) => userAxis.valueLabels[index]
            : defaultFormat);
    return {
        minimum: userAxis?.minimum ??
            calculateAxisMinimum({ data, prop: axisName, filterGroupIndex }),
        maximum: userAxis?.maximum ??
            calculateAxisMaximum({ data, prop: axisName, filterGroupIndex }),
        label: userAxis?.label ?? "",
        type: userAxis?.type ?? "linear",
        format,
        continuous: userAxis.continuous ?? false
    };
};
const detectDataPointType = (query) => {
    if (typeof query === "number") {
        return "number";
    }
    if (typeof query !== "object") {
        return "unknown";
    }
    if (isSimpleDataPoint(query)) {
        return "SimpleDataPoint";
    }
    if (isAlternateAxisDataPoint(query)) {
        return "AlternativeAxisDataPoint";
    }
    if (isOHLCDataPoint(query)) {
        return "OHLCDataPoint";
    }
    if (isBoxDataPoint(query)) {
        return "BoxDataPoint";
    }
    if (isHighLowDataPoint(query)) {
        return "HighLowDataPoint";
    }
    return "unknown";
};
const convertDataRow = (row) => {
    if (row === null) {
        return null;
    }
    return row.map((point, index) => {
        if (typeof point === "number") {
            return {
                x: index,
                y: point
            };
        }
        return point;
    });
};
const formatWrapper = ({ axis, translationCallback }) => {
    const format = (num) => {
        if (isNaN(num)) {
            return translationCallback("missing");
        }
        if (typeof axis.minimum === "number" && num < axis.minimum) {
            return translationCallback("tooLow");
        }
        if (typeof axis.maximum === "number" && num > axis.maximum) {
            return translationCallback("tooHigh");
        }
        return axis.format(num);
    };
    return format;
};
const generateChartSummary = ({ title, groupCount, live = false, hierarchy = false, translationCallback }) => {
    const text = ["summ", "chart"];
    if (live) {
        text.push("live");
    }
    if (hierarchy) {
        text.push("hier");
    }
    if (groupCount > 1) {
        text.push("group");
    }
    if (title.length > 0) {
        text.push("title");
    }
    return translationCallback(text.join("-"), {
        groupCount,
        title
    });
};
const axisDescriptions = {
    x: "X",
    y: "Y",
    y2: "Alternate Y"
};
const generateAxisSummary = ({ axisLetter, axis, translationCallback }) => {
    const code = ["axis", "desc"];
    if (axis.type === "log10") {
        code.push("log");
    }
    if (axisLetter === "x" && axis.continuous) {
        code.push("con");
    }
    return translationCallback(code.join("-"), {
        letter: axisDescriptions[axisLetter],
        label: axis.label ?? "",
        min: axis.format(axis.minimum),
        max: axis.format(axis.maximum)
    });
};
const generateInstructions = ({ hierarchy, live, hasNotes, translationCallback }) => {
    const keyboardMessage = filteredJoin([
        translationCallback("instructionArrows"),
        hierarchy && translationCallback("instructionHierarchy"),
        live && translationCallback("instructionLive"),
        translationCallback("instructionHotkeys")
    ], " ");
    const info = [keyboardMessage];
    if (hasNotes) {
        info.unshift("Has notes.");
    }
    return info.join(" ");
};
const isUnplayable = (yValue, yAxis) => {
    return isNaN(yValue) || yValue < yAxis.minimum || yValue > yAxis.maximum;
};
const prepChartElement = ({ elem, title, translationCallback, addCleanupTask }) => {
    if (!elem.hasAttribute("alt") && !elem.hasAttribute("aria-label")) {
        const label = title
            ? translationCallback("description", { title })
            : translationCallback("description-untitled");
        elem.setAttribute("aria-label", label);
        addCleanupTask(() => elem.removeAttribute("aria-label"));
    }
    if (!elem.hasAttribute("role")) {
        elem.setAttribute("role", "application");
        addCleanupTask(() => elem.removeAttribute("role"));
    }
};
const checkForNumberInput = (metadataByGroup, data) => {
    if (Array.isArray(data) && typeof data[0] === "number") {
        metadataByGroup[0].inputType = "number";
    }
    else {
        let index = 0;
        for (const group in data) {
            const row = data[group];
            if (row !== null &&
                Array.isArray(row) &&
                detectDataPointType(row.at(0)) === "number") {
                metadataByGroup[index].inputType = "number";
            }
            index++;
        }
    }
    return metadataByGroup;
};
const detectIfMobile = () => {
    const toMatch = [
        /Android/i,
        /webOS/i,
        /iPhone/i,
        /iPad/i,
        /iPod/i,
        /BlackBerry/i,
        /Windows Phone/i
    ];
    return toMatch.some((toMatchItem) => {
        return navigator.userAgent.match(toMatchItem);
    });
};
const filteredJoin = (arr, joiner) => arr.filter((item) => Boolean(item)).join(joiner);
const determineCC = (containerElement, cleanUpFnCallback, providedCC) => {
    if (providedCC) {
        return providedCC;
    }
    const generatedCC = document.createElement("div");
    containerElement.appendChild(generatedCC);
    cleanUpFnCallback(() => {
        generatedCC.remove();
    });
    return generatedCC;
};

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */

var extendStatics = function(d, b) {
    extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
    return extendStatics(d, b);
};

function __extends(d, b) {
    if (typeof b !== "function" && b !== null)
        throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
    extendStatics(d, b);
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

function __rest(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
}

function __spreadArray(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

//
// Main
//
function memoize(fn, options) {
    var cache = options && options.cache ? options.cache : cacheDefault;
    var serializer = options && options.serializer ? options.serializer : serializerDefault;
    var strategy = options && options.strategy ? options.strategy : strategyDefault;
    return strategy(fn, {
        cache: cache,
        serializer: serializer,
    });
}
//
// Strategy
//
function isPrimitive(value) {
    return (value == null || typeof value === 'number' || typeof value === 'boolean'); // || typeof value === "string" 'unsafe' primitive for our needs
}
function monadic(fn, cache, serializer, arg) {
    var cacheKey = isPrimitive(arg) ? arg : serializer(arg);
    var computedValue = cache.get(cacheKey);
    if (typeof computedValue === 'undefined') {
        computedValue = fn.call(this, arg);
        cache.set(cacheKey, computedValue);
    }
    return computedValue;
}
function variadic(fn, cache, serializer) {
    var args = Array.prototype.slice.call(arguments, 3);
    var cacheKey = serializer(args);
    var computedValue = cache.get(cacheKey);
    if (typeof computedValue === 'undefined') {
        computedValue = fn.apply(this, args);
        cache.set(cacheKey, computedValue);
    }
    return computedValue;
}
function assemble(fn, context, strategy, cache, serialize) {
    return strategy.bind(context, fn, cache, serialize);
}
function strategyDefault(fn, options) {
    var strategy = fn.length === 1 ? monadic : variadic;
    return assemble(fn, this, strategy, options.cache.create(), options.serializer);
}
function strategyVariadic(fn, options) {
    return assemble(fn, this, variadic, options.cache.create(), options.serializer);
}
//
// Serializer
//
var serializerDefault = function () {
    return JSON.stringify(arguments);
};
//
// Cache
//
var ObjectWithoutPrototypeCache = /** @class */ (function () {
    function ObjectWithoutPrototypeCache() {
        this.cache = Object.create(null);
    }
    ObjectWithoutPrototypeCache.prototype.get = function (key) {
        return this.cache[key];
    };
    ObjectWithoutPrototypeCache.prototype.set = function (key, value) {
        this.cache[key] = value;
    };
    return ObjectWithoutPrototypeCache;
}());
var cacheDefault = {
    create: function create() {
        return new ObjectWithoutPrototypeCache();
    },
};
var strategies = {
    variadic: strategyVariadic};

var ErrorKind;
(function (ErrorKind) {
    /** Argument is unclosed (e.g. `{0`) */
    ErrorKind[ErrorKind["EXPECT_ARGUMENT_CLOSING_BRACE"] = 1] = "EXPECT_ARGUMENT_CLOSING_BRACE";
    /** Argument is empty (e.g. `{}`). */
    ErrorKind[ErrorKind["EMPTY_ARGUMENT"] = 2] = "EMPTY_ARGUMENT";
    /** Argument is malformed (e.g. `{foo!}``) */
    ErrorKind[ErrorKind["MALFORMED_ARGUMENT"] = 3] = "MALFORMED_ARGUMENT";
    /** Expect an argument type (e.g. `{foo,}`) */
    ErrorKind[ErrorKind["EXPECT_ARGUMENT_TYPE"] = 4] = "EXPECT_ARGUMENT_TYPE";
    /** Unsupported argument type (e.g. `{foo,foo}`) */
    ErrorKind[ErrorKind["INVALID_ARGUMENT_TYPE"] = 5] = "INVALID_ARGUMENT_TYPE";
    /** Expect an argument style (e.g. `{foo, number, }`) */
    ErrorKind[ErrorKind["EXPECT_ARGUMENT_STYLE"] = 6] = "EXPECT_ARGUMENT_STYLE";
    /** The number skeleton is invalid. */
    ErrorKind[ErrorKind["INVALID_NUMBER_SKELETON"] = 7] = "INVALID_NUMBER_SKELETON";
    /** The date time skeleton is invalid. */
    ErrorKind[ErrorKind["INVALID_DATE_TIME_SKELETON"] = 8] = "INVALID_DATE_TIME_SKELETON";
    /** Exepct a number skeleton following the `::` (e.g. `{foo, number, ::}`) */
    ErrorKind[ErrorKind["EXPECT_NUMBER_SKELETON"] = 9] = "EXPECT_NUMBER_SKELETON";
    /** Exepct a date time skeleton following the `::` (e.g. `{foo, date, ::}`) */
    ErrorKind[ErrorKind["EXPECT_DATE_TIME_SKELETON"] = 10] = "EXPECT_DATE_TIME_SKELETON";
    /** Unmatched apostrophes in the argument style (e.g. `{foo, number, 'test`) */
    ErrorKind[ErrorKind["UNCLOSED_QUOTE_IN_ARGUMENT_STYLE"] = 11] = "UNCLOSED_QUOTE_IN_ARGUMENT_STYLE";
    /** Missing select argument options (e.g. `{foo, select}`) */
    ErrorKind[ErrorKind["EXPECT_SELECT_ARGUMENT_OPTIONS"] = 12] = "EXPECT_SELECT_ARGUMENT_OPTIONS";
    /** Expecting an offset value in `plural` or `selectordinal` argument (e.g `{foo, plural, offset}`) */
    ErrorKind[ErrorKind["EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE"] = 13] = "EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE";
    /** Offset value in `plural` or `selectordinal` is invalid (e.g. `{foo, plural, offset: x}`) */
    ErrorKind[ErrorKind["INVALID_PLURAL_ARGUMENT_OFFSET_VALUE"] = 14] = "INVALID_PLURAL_ARGUMENT_OFFSET_VALUE";
    /** Expecting a selector in `select` argument (e.g `{foo, select}`) */
    ErrorKind[ErrorKind["EXPECT_SELECT_ARGUMENT_SELECTOR"] = 15] = "EXPECT_SELECT_ARGUMENT_SELECTOR";
    /** Expecting a selector in `plural` or `selectordinal` argument (e.g `{foo, plural}`) */
    ErrorKind[ErrorKind["EXPECT_PLURAL_ARGUMENT_SELECTOR"] = 16] = "EXPECT_PLURAL_ARGUMENT_SELECTOR";
    /** Expecting a message fragment after the `select` selector (e.g. `{foo, select, apple}`) */
    ErrorKind[ErrorKind["EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT"] = 17] = "EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT";
    /**
     * Expecting a message fragment after the `plural` or `selectordinal` selector
     * (e.g. `{foo, plural, one}`)
     */
    ErrorKind[ErrorKind["EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT"] = 18] = "EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT";
    /** Selector in `plural` or `selectordinal` is malformed (e.g. `{foo, plural, =x {#}}`) */
    ErrorKind[ErrorKind["INVALID_PLURAL_ARGUMENT_SELECTOR"] = 19] = "INVALID_PLURAL_ARGUMENT_SELECTOR";
    /**
     * Duplicate selectors in `plural` or `selectordinal` argument.
     * (e.g. {foo, plural, one {#} one {#}})
     */
    ErrorKind[ErrorKind["DUPLICATE_PLURAL_ARGUMENT_SELECTOR"] = 20] = "DUPLICATE_PLURAL_ARGUMENT_SELECTOR";
    /** Duplicate selectors in `select` argument.
     * (e.g. {foo, select, apple {apple} apple {apple}})
     */
    ErrorKind[ErrorKind["DUPLICATE_SELECT_ARGUMENT_SELECTOR"] = 21] = "DUPLICATE_SELECT_ARGUMENT_SELECTOR";
    /** Plural or select argument option must have `other` clause. */
    ErrorKind[ErrorKind["MISSING_OTHER_CLAUSE"] = 22] = "MISSING_OTHER_CLAUSE";
    /** The tag is malformed. (e.g. `<bold!>foo</bold!>) */
    ErrorKind[ErrorKind["INVALID_TAG"] = 23] = "INVALID_TAG";
    /** The tag name is invalid. (e.g. `<123>foo</123>`) */
    ErrorKind[ErrorKind["INVALID_TAG_NAME"] = 25] = "INVALID_TAG_NAME";
    /** The closing tag does not match the opening tag. (e.g. `<bold>foo</italic>`) */
    ErrorKind[ErrorKind["UNMATCHED_CLOSING_TAG"] = 26] = "UNMATCHED_CLOSING_TAG";
    /** The opening tag has unmatched closing tag. (e.g. `<bold>foo`) */
    ErrorKind[ErrorKind["UNCLOSED_TAG"] = 27] = "UNCLOSED_TAG";
})(ErrorKind || (ErrorKind = {}));

var TYPE;
(function (TYPE) {
    /**
     * Raw text
     */
    TYPE[TYPE["literal"] = 0] = "literal";
    /**
     * Variable w/o any format, e.g `var` in `this is a {var}`
     */
    TYPE[TYPE["argument"] = 1] = "argument";
    /**
     * Variable w/ number format
     */
    TYPE[TYPE["number"] = 2] = "number";
    /**
     * Variable w/ date format
     */
    TYPE[TYPE["date"] = 3] = "date";
    /**
     * Variable w/ time format
     */
    TYPE[TYPE["time"] = 4] = "time";
    /**
     * Variable w/ select format
     */
    TYPE[TYPE["select"] = 5] = "select";
    /**
     * Variable w/ plural format
     */
    TYPE[TYPE["plural"] = 6] = "plural";
    /**
     * Only possible within plural argument.
     * This is the `#` symbol that will be substituted with the count.
     */
    TYPE[TYPE["pound"] = 7] = "pound";
    /**
     * XML-like tag
     */
    TYPE[TYPE["tag"] = 8] = "tag";
})(TYPE || (TYPE = {}));
var SKELETON_TYPE;
(function (SKELETON_TYPE) {
    SKELETON_TYPE[SKELETON_TYPE["number"] = 0] = "number";
    SKELETON_TYPE[SKELETON_TYPE["dateTime"] = 1] = "dateTime";
})(SKELETON_TYPE || (SKELETON_TYPE = {}));
/**
 * Type Guards
 */
function isLiteralElement(el) {
    return el.type === TYPE.literal;
}
function isArgumentElement(el) {
    return el.type === TYPE.argument;
}
function isNumberElement(el) {
    return el.type === TYPE.number;
}
function isDateElement(el) {
    return el.type === TYPE.date;
}
function isTimeElement(el) {
    return el.type === TYPE.time;
}
function isSelectElement(el) {
    return el.type === TYPE.select;
}
function isPluralElement(el) {
    return el.type === TYPE.plural;
}
function isPoundElement(el) {
    return el.type === TYPE.pound;
}
function isTagElement(el) {
    return el.type === TYPE.tag;
}
function isNumberSkeleton(el) {
    return !!(el && typeof el === 'object' && el.type === SKELETON_TYPE.number);
}
function isDateTimeSkeleton(el) {
    return !!(el && typeof el === 'object' && el.type === SKELETON_TYPE.dateTime);
}

// @generated from regex-gen.ts
var SPACE_SEPARATOR_REGEX = /[ \xA0\u1680\u2000-\u200A\u202F\u205F\u3000]/;

/**
 * https://unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
 * Credit: https://github.com/caridy/intl-datetimeformat-pattern/blob/master/index.js
 * with some tweaks
 */
var DATE_TIME_REGEX = /(?:[Eec]{1,6}|G{1,5}|[Qq]{1,5}|(?:[yYur]+|U{1,5})|[ML]{1,5}|d{1,2}|D{1,3}|F{1}|[abB]{1,5}|[hkHK]{1,2}|w{1,2}|W{1}|m{1,2}|s{1,2}|[zZOvVxX]{1,4})(?=([^']*'[^']*')*[^']*$)/g;
/**
 * Parse Date time skeleton into Intl.DateTimeFormatOptions
 * Ref: https://unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
 * @public
 * @param skeleton skeleton string
 */
function parseDateTimeSkeleton(skeleton) {
    var result = {};
    skeleton.replace(DATE_TIME_REGEX, function (match) {
        var len = match.length;
        switch (match[0]) {
            // Era
            case 'G':
                result.era = len === 4 ? 'long' : len === 5 ? 'narrow' : 'short';
                break;
            // Year
            case 'y':
                result.year = len === 2 ? '2-digit' : 'numeric';
                break;
            case 'Y':
            case 'u':
            case 'U':
            case 'r':
                throw new RangeError('`Y/u/U/r` (year) patterns are not supported, use `y` instead');
            // Quarter
            case 'q':
            case 'Q':
                throw new RangeError('`q/Q` (quarter) patterns are not supported');
            // Month
            case 'M':
            case 'L':
                result.month = ['numeric', '2-digit', 'short', 'long', 'narrow'][len - 1];
                break;
            // Week
            case 'w':
            case 'W':
                throw new RangeError('`w/W` (week) patterns are not supported');
            case 'd':
                result.day = ['numeric', '2-digit'][len - 1];
                break;
            case 'D':
            case 'F':
            case 'g':
                throw new RangeError('`D/F/g` (day) patterns are not supported, use `d` instead');
            // Weekday
            case 'E':
                result.weekday = len === 4 ? 'long' : len === 5 ? 'narrow' : 'short';
                break;
            case 'e':
                if (len < 4) {
                    throw new RangeError('`e..eee` (weekday) patterns are not supported');
                }
                result.weekday = ['short', 'long', 'narrow', 'short'][len - 4];
                break;
            case 'c':
                if (len < 4) {
                    throw new RangeError('`c..ccc` (weekday) patterns are not supported');
                }
                result.weekday = ['short', 'long', 'narrow', 'short'][len - 4];
                break;
            // Period
            case 'a': // AM, PM
                result.hour12 = true;
                break;
            case 'b': // am, pm, noon, midnight
            case 'B': // flexible day periods
                throw new RangeError('`b/B` (period) patterns are not supported, use `a` instead');
            // Hour
            case 'h':
                result.hourCycle = 'h12';
                result.hour = ['numeric', '2-digit'][len - 1];
                break;
            case 'H':
                result.hourCycle = 'h23';
                result.hour = ['numeric', '2-digit'][len - 1];
                break;
            case 'K':
                result.hourCycle = 'h11';
                result.hour = ['numeric', '2-digit'][len - 1];
                break;
            case 'k':
                result.hourCycle = 'h24';
                result.hour = ['numeric', '2-digit'][len - 1];
                break;
            case 'j':
            case 'J':
            case 'C':
                throw new RangeError('`j/J/C` (hour) patterns are not supported, use `h/H/K/k` instead');
            // Minute
            case 'm':
                result.minute = ['numeric', '2-digit'][len - 1];
                break;
            // Second
            case 's':
                result.second = ['numeric', '2-digit'][len - 1];
                break;
            case 'S':
            case 'A':
                throw new RangeError('`S/A` (second) patterns are not supported, use `s` instead');
            // Zone
            case 'z': // 1..3, 4: specific non-location format
                result.timeZoneName = len < 4 ? 'short' : 'long';
                break;
            case 'Z': // 1..3, 4, 5: The ISO8601 varios formats
            case 'O': // 1, 4: milliseconds in day short, long
            case 'v': // 1, 4: generic non-location format
            case 'V': // 1, 2, 3, 4: time zone ID or city
            case 'X': // 1, 2, 3, 4: The ISO8601 varios formats
            case 'x': // 1, 2, 3, 4: The ISO8601 varios formats
                throw new RangeError('`Z/O/v/V/X/x` (timeZone) patterns are not supported, use `z` instead');
        }
        return '';
    });
    return result;
}

// @generated from regex-gen.ts
var WHITE_SPACE_REGEX = /[\t-\r \x85\u200E\u200F\u2028\u2029]/i;

function parseNumberSkeletonFromString(skeleton) {
    if (skeleton.length === 0) {
        throw new Error('Number skeleton cannot be empty');
    }
    // Parse the skeleton
    var stringTokens = skeleton
        .split(WHITE_SPACE_REGEX)
        .filter(function (x) { return x.length > 0; });
    var tokens = [];
    for (var _i = 0, stringTokens_1 = stringTokens; _i < stringTokens_1.length; _i++) {
        var stringToken = stringTokens_1[_i];
        var stemAndOptions = stringToken.split('/');
        if (stemAndOptions.length === 0) {
            throw new Error('Invalid number skeleton');
        }
        var stem = stemAndOptions[0], options = stemAndOptions.slice(1);
        for (var _a = 0, options_1 = options; _a < options_1.length; _a++) {
            var option = options_1[_a];
            if (option.length === 0) {
                throw new Error('Invalid number skeleton');
            }
        }
        tokens.push({ stem: stem, options: options });
    }
    return tokens;
}
function icuUnitToEcma(unit) {
    return unit.replace(/^(.*?)-/, '');
}
var FRACTION_PRECISION_REGEX = /^\.(?:(0+)(\*)?|(#+)|(0+)(#+))$/g;
var SIGNIFICANT_PRECISION_REGEX = /^(@+)?(\+|#+)?[rs]?$/g;
var INTEGER_WIDTH_REGEX = /(\*)(0+)|(#+)(0+)|(0+)/g;
var CONCISE_INTEGER_WIDTH_REGEX = /^(0+)$/;
function parseSignificantPrecision(str) {
    var result = {};
    if (str[str.length - 1] === 'r') {
        result.roundingPriority = 'morePrecision';
    }
    else if (str[str.length - 1] === 's') {
        result.roundingPriority = 'lessPrecision';
    }
    str.replace(SIGNIFICANT_PRECISION_REGEX, function (_, g1, g2) {
        // @@@ case
        if (typeof g2 !== 'string') {
            result.minimumSignificantDigits = g1.length;
            result.maximumSignificantDigits = g1.length;
        }
        // @@@+ case
        else if (g2 === '+') {
            result.minimumSignificantDigits = g1.length;
        }
        // .### case
        else if (g1[0] === '#') {
            result.maximumSignificantDigits = g1.length;
        }
        // .@@## or .@@@ case
        else {
            result.minimumSignificantDigits = g1.length;
            result.maximumSignificantDigits =
                g1.length + (typeof g2 === 'string' ? g2.length : 0);
        }
        return '';
    });
    return result;
}
function parseSign(str) {
    switch (str) {
        case 'sign-auto':
            return {
                signDisplay: 'auto',
            };
        case 'sign-accounting':
        case '()':
            return {
                currencySign: 'accounting',
            };
        case 'sign-always':
        case '+!':
            return {
                signDisplay: 'always',
            };
        case 'sign-accounting-always':
        case '()!':
            return {
                signDisplay: 'always',
                currencySign: 'accounting',
            };
        case 'sign-except-zero':
        case '+?':
            return {
                signDisplay: 'exceptZero',
            };
        case 'sign-accounting-except-zero':
        case '()?':
            return {
                signDisplay: 'exceptZero',
                currencySign: 'accounting',
            };
        case 'sign-never':
        case '+_':
            return {
                signDisplay: 'never',
            };
    }
}
function parseConciseScientificAndEngineeringStem(stem) {
    // Engineering
    var result;
    if (stem[0] === 'E' && stem[1] === 'E') {
        result = {
            notation: 'engineering',
        };
        stem = stem.slice(2);
    }
    else if (stem[0] === 'E') {
        result = {
            notation: 'scientific',
        };
        stem = stem.slice(1);
    }
    if (result) {
        var signDisplay = stem.slice(0, 2);
        if (signDisplay === '+!') {
            result.signDisplay = 'always';
            stem = stem.slice(2);
        }
        else if (signDisplay === '+?') {
            result.signDisplay = 'exceptZero';
            stem = stem.slice(2);
        }
        if (!CONCISE_INTEGER_WIDTH_REGEX.test(stem)) {
            throw new Error('Malformed concise eng/scientific notation');
        }
        result.minimumIntegerDigits = stem.length;
    }
    return result;
}
function parseNotationOptions(opt) {
    var result = {};
    var signOpts = parseSign(opt);
    if (signOpts) {
        return signOpts;
    }
    return result;
}
/**
 * https://github.com/unicode-org/icu/blob/master/docs/userguide/format_parse/numbers/skeletons.md#skeleton-stems-and-options
 */
function parseNumberSkeleton(tokens) {
    var result = {};
    for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
        var token = tokens_1[_i];
        switch (token.stem) {
            case 'percent':
            case '%':
                result.style = 'percent';
                continue;
            case '%x100':
                result.style = 'percent';
                result.scale = 100;
                continue;
            case 'currency':
                result.style = 'currency';
                result.currency = token.options[0];
                continue;
            case 'group-off':
            case ',_':
                result.useGrouping = false;
                continue;
            case 'precision-integer':
            case '.':
                result.maximumFractionDigits = 0;
                continue;
            case 'measure-unit':
            case 'unit':
                result.style = 'unit';
                result.unit = icuUnitToEcma(token.options[0]);
                continue;
            case 'compact-short':
            case 'K':
                result.notation = 'compact';
                result.compactDisplay = 'short';
                continue;
            case 'compact-long':
            case 'KK':
                result.notation = 'compact';
                result.compactDisplay = 'long';
                continue;
            case 'scientific':
                result = __assign(__assign(__assign({}, result), { notation: 'scientific' }), token.options.reduce(function (all, opt) { return (__assign(__assign({}, all), parseNotationOptions(opt))); }, {}));
                continue;
            case 'engineering':
                result = __assign(__assign(__assign({}, result), { notation: 'engineering' }), token.options.reduce(function (all, opt) { return (__assign(__assign({}, all), parseNotationOptions(opt))); }, {}));
                continue;
            case 'notation-simple':
                result.notation = 'standard';
                continue;
            // https://github.com/unicode-org/icu/blob/master/icu4c/source/i18n/unicode/unumberformatter.h
            case 'unit-width-narrow':
                result.currencyDisplay = 'narrowSymbol';
                result.unitDisplay = 'narrow';
                continue;
            case 'unit-width-short':
                result.currencyDisplay = 'code';
                result.unitDisplay = 'short';
                continue;
            case 'unit-width-full-name':
                result.currencyDisplay = 'name';
                result.unitDisplay = 'long';
                continue;
            case 'unit-width-iso-code':
                result.currencyDisplay = 'symbol';
                continue;
            case 'scale':
                result.scale = parseFloat(token.options[0]);
                continue;
            case 'rounding-mode-floor':
                result.roundingMode = 'floor';
                continue;
            case 'rounding-mode-ceiling':
                result.roundingMode = 'ceil';
                continue;
            case 'rounding-mode-down':
                result.roundingMode = 'trunc';
                continue;
            case 'rounding-mode-up':
                result.roundingMode = 'expand';
                continue;
            case 'rounding-mode-half-even':
                result.roundingMode = 'halfEven';
                continue;
            case 'rounding-mode-half-down':
                result.roundingMode = 'halfTrunc';
                continue;
            case 'rounding-mode-half-up':
                result.roundingMode = 'halfExpand';
                continue;
            // https://unicode-org.github.io/icu/userguide/format_parse/numbers/skeletons.html#integer-width
            case 'integer-width':
                if (token.options.length > 1) {
                    throw new RangeError('integer-width stems only accept a single optional option');
                }
                token.options[0].replace(INTEGER_WIDTH_REGEX, function (_, g1, g2, g3, g4, g5) {
                    if (g1) {
                        result.minimumIntegerDigits = g2.length;
                    }
                    else if (g3 && g4) {
                        throw new Error('We currently do not support maximum integer digits');
                    }
                    else if (g5) {
                        throw new Error('We currently do not support exact integer digits');
                    }
                    return '';
                });
                continue;
        }
        // https://unicode-org.github.io/icu/userguide/format_parse/numbers/skeletons.html#integer-width
        if (CONCISE_INTEGER_WIDTH_REGEX.test(token.stem)) {
            result.minimumIntegerDigits = token.stem.length;
            continue;
        }
        if (FRACTION_PRECISION_REGEX.test(token.stem)) {
            // Precision
            // https://unicode-org.github.io/icu/userguide/format_parse/numbers/skeletons.html#fraction-precision
            // precision-integer case
            if (token.options.length > 1) {
                throw new RangeError('Fraction-precision stems only accept a single optional option');
            }
            token.stem.replace(FRACTION_PRECISION_REGEX, function (_, g1, g2, g3, g4, g5) {
                // .000* case (before ICU67 it was .000+)
                if (g2 === '*') {
                    result.minimumFractionDigits = g1.length;
                }
                // .### case
                else if (g3 && g3[0] === '#') {
                    result.maximumFractionDigits = g3.length;
                }
                // .00## case
                else if (g4 && g5) {
                    result.minimumFractionDigits = g4.length;
                    result.maximumFractionDigits = g4.length + g5.length;
                }
                else {
                    result.minimumFractionDigits = g1.length;
                    result.maximumFractionDigits = g1.length;
                }
                return '';
            });
            var opt = token.options[0];
            // https://unicode-org.github.io/icu/userguide/format_parse/numbers/skeletons.html#trailing-zero-display
            if (opt === 'w') {
                result = __assign(__assign({}, result), { trailingZeroDisplay: 'stripIfInteger' });
            }
            else if (opt) {
                result = __assign(__assign({}, result), parseSignificantPrecision(opt));
            }
            continue;
        }
        // https://unicode-org.github.io/icu/userguide/format_parse/numbers/skeletons.html#significant-digits-precision
        if (SIGNIFICANT_PRECISION_REGEX.test(token.stem)) {
            result = __assign(__assign({}, result), parseSignificantPrecision(token.stem));
            continue;
        }
        var signOpts = parseSign(token.stem);
        if (signOpts) {
            result = __assign(__assign({}, result), signOpts);
        }
        var conciseScientificAndEngineeringOpts = parseConciseScientificAndEngineeringStem(token.stem);
        if (conciseScientificAndEngineeringOpts) {
            result = __assign(__assign({}, result), conciseScientificAndEngineeringOpts);
        }
    }
    return result;
}

// @generated from time-data-gen.ts
// prettier-ignore  
var timeData = {
    "001": [
        "H",
        "h"
    ],
    "419": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "AC": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "AD": [
        "H",
        "hB"
    ],
    "AE": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "AF": [
        "H",
        "hb",
        "hB",
        "h"
    ],
    "AG": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "AI": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "AL": [
        "h",
        "H",
        "hB"
    ],
    "AM": [
        "H",
        "hB"
    ],
    "AO": [
        "H",
        "hB"
    ],
    "AR": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "AS": [
        "h",
        "H"
    ],
    "AT": [
        "H",
        "hB"
    ],
    "AU": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "AW": [
        "H",
        "hB"
    ],
    "AX": [
        "H"
    ],
    "AZ": [
        "H",
        "hB",
        "h"
    ],
    "BA": [
        "H",
        "hB",
        "h"
    ],
    "BB": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "BD": [
        "h",
        "hB",
        "H"
    ],
    "BE": [
        "H",
        "hB"
    ],
    "BF": [
        "H",
        "hB"
    ],
    "BG": [
        "H",
        "hB",
        "h"
    ],
    "BH": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "BI": [
        "H",
        "h"
    ],
    "BJ": [
        "H",
        "hB"
    ],
    "BL": [
        "H",
        "hB"
    ],
    "BM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "BN": [
        "hb",
        "hB",
        "h",
        "H"
    ],
    "BO": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "BQ": [
        "H"
    ],
    "BR": [
        "H",
        "hB"
    ],
    "BS": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "BT": [
        "h",
        "H"
    ],
    "BW": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "BY": [
        "H",
        "h"
    ],
    "BZ": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "CA": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "CC": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "CD": [
        "hB",
        "H"
    ],
    "CF": [
        "H",
        "h",
        "hB"
    ],
    "CG": [
        "H",
        "hB"
    ],
    "CH": [
        "H",
        "hB",
        "h"
    ],
    "CI": [
        "H",
        "hB"
    ],
    "CK": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "CL": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "CM": [
        "H",
        "h",
        "hB"
    ],
    "CN": [
        "H",
        "hB",
        "hb",
        "h"
    ],
    "CO": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "CP": [
        "H"
    ],
    "CR": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "CU": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "CV": [
        "H",
        "hB"
    ],
    "CW": [
        "H",
        "hB"
    ],
    "CX": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "CY": [
        "h",
        "H",
        "hb",
        "hB"
    ],
    "CZ": [
        "H"
    ],
    "DE": [
        "H",
        "hB"
    ],
    "DG": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "DJ": [
        "h",
        "H"
    ],
    "DK": [
        "H"
    ],
    "DM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "DO": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "DZ": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "EA": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "EC": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "EE": [
        "H",
        "hB"
    ],
    "EG": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "EH": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "ER": [
        "h",
        "H"
    ],
    "ES": [
        "H",
        "hB",
        "h",
        "hb"
    ],
    "ET": [
        "hB",
        "hb",
        "h",
        "H"
    ],
    "FI": [
        "H"
    ],
    "FJ": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "FK": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "FM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "FO": [
        "H",
        "h"
    ],
    "FR": [
        "H",
        "hB"
    ],
    "GA": [
        "H",
        "hB"
    ],
    "GB": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "GD": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "GE": [
        "H",
        "hB",
        "h"
    ],
    "GF": [
        "H",
        "hB"
    ],
    "GG": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "GH": [
        "h",
        "H"
    ],
    "GI": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "GL": [
        "H",
        "h"
    ],
    "GM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "GN": [
        "H",
        "hB"
    ],
    "GP": [
        "H",
        "hB"
    ],
    "GQ": [
        "H",
        "hB",
        "h",
        "hb"
    ],
    "GR": [
        "h",
        "H",
        "hb",
        "hB"
    ],
    "GT": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "GU": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "GW": [
        "H",
        "hB"
    ],
    "GY": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "HK": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "HN": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "HR": [
        "H",
        "hB"
    ],
    "HU": [
        "H",
        "h"
    ],
    "IC": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "ID": [
        "H"
    ],
    "IE": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "IL": [
        "H",
        "hB"
    ],
    "IM": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "IN": [
        "h",
        "H"
    ],
    "IO": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "IQ": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "IR": [
        "hB",
        "H"
    ],
    "IS": [
        "H"
    ],
    "IT": [
        "H",
        "hB"
    ],
    "JE": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "JM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "JO": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "JP": [
        "H",
        "K",
        "h"
    ],
    "KE": [
        "hB",
        "hb",
        "H",
        "h"
    ],
    "KG": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "KH": [
        "hB",
        "h",
        "H",
        "hb"
    ],
    "KI": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "KM": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "KN": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "KP": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "KR": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "KW": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "KY": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "KZ": [
        "H",
        "hB"
    ],
    "LA": [
        "H",
        "hb",
        "hB",
        "h"
    ],
    "LB": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "LC": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "LI": [
        "H",
        "hB",
        "h"
    ],
    "LK": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "LR": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "LS": [
        "h",
        "H"
    ],
    "LT": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "LU": [
        "H",
        "h",
        "hB"
    ],
    "LV": [
        "H",
        "hB",
        "hb",
        "h"
    ],
    "LY": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "MA": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "MC": [
        "H",
        "hB"
    ],
    "MD": [
        "H",
        "hB"
    ],
    "ME": [
        "H",
        "hB",
        "h"
    ],
    "MF": [
        "H",
        "hB"
    ],
    "MG": [
        "H",
        "h"
    ],
    "MH": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "MK": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "ML": [
        "H"
    ],
    "MM": [
        "hB",
        "hb",
        "H",
        "h"
    ],
    "MN": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "MO": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "MP": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "MQ": [
        "H",
        "hB"
    ],
    "MR": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "MS": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "MT": [
        "H",
        "h"
    ],
    "MU": [
        "H",
        "h"
    ],
    "MV": [
        "H",
        "h"
    ],
    "MW": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "MX": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "MY": [
        "hb",
        "hB",
        "h",
        "H"
    ],
    "MZ": [
        "H",
        "hB"
    ],
    "NA": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "NC": [
        "H",
        "hB"
    ],
    "NE": [
        "H"
    ],
    "NF": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "NG": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "NI": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "NL": [
        "H",
        "hB"
    ],
    "NO": [
        "H",
        "h"
    ],
    "NP": [
        "H",
        "h",
        "hB"
    ],
    "NR": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "NU": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "NZ": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "OM": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "PA": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "PE": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "PF": [
        "H",
        "h",
        "hB"
    ],
    "PG": [
        "h",
        "H"
    ],
    "PH": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "PK": [
        "h",
        "hB",
        "H"
    ],
    "PL": [
        "H",
        "h"
    ],
    "PM": [
        "H",
        "hB"
    ],
    "PN": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "PR": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "PS": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "PT": [
        "H",
        "hB"
    ],
    "PW": [
        "h",
        "H"
    ],
    "PY": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "QA": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "RE": [
        "H",
        "hB"
    ],
    "RO": [
        "H",
        "hB"
    ],
    "RS": [
        "H",
        "hB",
        "h"
    ],
    "RU": [
        "H"
    ],
    "RW": [
        "H",
        "h"
    ],
    "SA": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "SB": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "SC": [
        "H",
        "h",
        "hB"
    ],
    "SD": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "SE": [
        "H"
    ],
    "SG": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "SH": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "SI": [
        "H",
        "hB"
    ],
    "SJ": [
        "H"
    ],
    "SK": [
        "H"
    ],
    "SL": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "SM": [
        "H",
        "h",
        "hB"
    ],
    "SN": [
        "H",
        "h",
        "hB"
    ],
    "SO": [
        "h",
        "H"
    ],
    "SR": [
        "H",
        "hB"
    ],
    "SS": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "ST": [
        "H",
        "hB"
    ],
    "SV": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "SX": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "SY": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "SZ": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "TA": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "TC": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "TD": [
        "h",
        "H",
        "hB"
    ],
    "TF": [
        "H",
        "h",
        "hB"
    ],
    "TG": [
        "H",
        "hB"
    ],
    "TH": [
        "H",
        "h"
    ],
    "TJ": [
        "H",
        "h"
    ],
    "TL": [
        "H",
        "hB",
        "hb",
        "h"
    ],
    "TM": [
        "H",
        "h"
    ],
    "TN": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "TO": [
        "h",
        "H"
    ],
    "TR": [
        "H",
        "hB"
    ],
    "TT": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "TW": [
        "hB",
        "hb",
        "h",
        "H"
    ],
    "TZ": [
        "hB",
        "hb",
        "H",
        "h"
    ],
    "UA": [
        "H",
        "hB",
        "h"
    ],
    "UG": [
        "hB",
        "hb",
        "H",
        "h"
    ],
    "UM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "US": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "UY": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "UZ": [
        "H",
        "hB",
        "h"
    ],
    "VA": [
        "H",
        "h",
        "hB"
    ],
    "VC": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "VE": [
        "h",
        "H",
        "hB",
        "hb"
    ],
    "VG": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "VI": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "VN": [
        "H",
        "h"
    ],
    "VU": [
        "h",
        "H"
    ],
    "WF": [
        "H",
        "hB"
    ],
    "WS": [
        "h",
        "H"
    ],
    "XK": [
        "H",
        "hB",
        "h"
    ],
    "YE": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "YT": [
        "H",
        "hB"
    ],
    "ZA": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "ZM": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "ZW": [
        "H",
        "h"
    ],
    "af-ZA": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "ar-001": [
        "h",
        "hB",
        "hb",
        "H"
    ],
    "ca-ES": [
        "H",
        "h",
        "hB"
    ],
    "en-001": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "en-HK": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "en-IL": [
        "H",
        "h",
        "hb",
        "hB"
    ],
    "en-MY": [
        "h",
        "hb",
        "H",
        "hB"
    ],
    "es-BR": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "es-ES": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "es-GQ": [
        "H",
        "h",
        "hB",
        "hb"
    ],
    "fr-CA": [
        "H",
        "h",
        "hB"
    ],
    "gl-ES": [
        "H",
        "h",
        "hB"
    ],
    "gu-IN": [
        "hB",
        "hb",
        "h",
        "H"
    ],
    "hi-IN": [
        "hB",
        "h",
        "H"
    ],
    "it-CH": [
        "H",
        "h",
        "hB"
    ],
    "it-IT": [
        "H",
        "h",
        "hB"
    ],
    "kn-IN": [
        "hB",
        "h",
        "H"
    ],
    "ml-IN": [
        "hB",
        "h",
        "H"
    ],
    "mr-IN": [
        "hB",
        "hb",
        "h",
        "H"
    ],
    "pa-IN": [
        "hB",
        "hb",
        "h",
        "H"
    ],
    "ta-IN": [
        "hB",
        "h",
        "hb",
        "H"
    ],
    "te-IN": [
        "hB",
        "h",
        "H"
    ],
    "zu-ZA": [
        "H",
        "hB",
        "hb",
        "h"
    ]
};

/**
 * Returns the best matching date time pattern if a date time skeleton
 * pattern is provided with a locale. Follows the Unicode specification:
 * https://www.unicode.org/reports/tr35/tr35-dates.html#table-mapping-requested-time-skeletons-to-patterns
 * @param skeleton date time skeleton pattern that possibly includes j, J or C
 * @param locale
 */
function getBestPattern(skeleton, locale) {
    var skeletonCopy = '';
    for (var patternPos = 0; patternPos < skeleton.length; patternPos++) {
        var patternChar = skeleton.charAt(patternPos);
        if (patternChar === 'j') {
            var extraLength = 0;
            while (patternPos + 1 < skeleton.length &&
                skeleton.charAt(patternPos + 1) === patternChar) {
                extraLength++;
                patternPos++;
            }
            var hourLen = 1 + (extraLength & 1);
            var dayPeriodLen = extraLength < 2 ? 1 : 3 + (extraLength >> 1);
            var dayPeriodChar = 'a';
            var hourChar = getDefaultHourSymbolFromLocale(locale);
            if (hourChar == 'H' || hourChar == 'k') {
                dayPeriodLen = 0;
            }
            while (dayPeriodLen-- > 0) {
                skeletonCopy += dayPeriodChar;
            }
            while (hourLen-- > 0) {
                skeletonCopy = hourChar + skeletonCopy;
            }
        }
        else if (patternChar === 'J') {
            skeletonCopy += 'H';
        }
        else {
            skeletonCopy += patternChar;
        }
    }
    return skeletonCopy;
}
/**
 * Maps the [hour cycle type](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/hourCycle)
 * of the given `locale` to the corresponding time pattern.
 * @param locale
 */
function getDefaultHourSymbolFromLocale(locale) {
    var hourCycle = locale.hourCycle;
    if (hourCycle === undefined &&
        // @ts-ignore hourCycle(s) is not identified yet
        locale.hourCycles &&
        // @ts-ignore
        locale.hourCycles.length) {
        // @ts-ignore
        hourCycle = locale.hourCycles[0];
    }
    if (hourCycle) {
        switch (hourCycle) {
            case 'h24':
                return 'k';
            case 'h23':
                return 'H';
            case 'h12':
                return 'h';
            case 'h11':
                return 'K';
            default:
                throw new Error('Invalid hourCycle');
        }
    }
    // TODO: Once hourCycle is fully supported remove the following with data generation
    var languageTag = locale.language;
    var regionTag;
    if (languageTag !== 'root') {
        regionTag = locale.maximize().region;
    }
    var hourCycles = timeData[regionTag || ''] ||
        timeData[languageTag || ''] ||
        timeData["".concat(languageTag, "-001")] ||
        timeData['001'];
    return hourCycles[0];
}

var _a;
var SPACE_SEPARATOR_START_REGEX = new RegExp("^".concat(SPACE_SEPARATOR_REGEX.source, "*"));
var SPACE_SEPARATOR_END_REGEX = new RegExp("".concat(SPACE_SEPARATOR_REGEX.source, "*$"));
function createLocation(start, end) {
    return { start: start, end: end };
}
// #region Ponyfills
// Consolidate these variables up top for easier toggling during debugging
var hasNativeStartsWith = !!String.prototype.startsWith && '_a'.startsWith('a', 1);
var hasNativeFromCodePoint = !!String.fromCodePoint;
var hasNativeFromEntries = !!Object.fromEntries;
var hasNativeCodePointAt = !!String.prototype.codePointAt;
var hasTrimStart = !!String.prototype.trimStart;
var hasTrimEnd = !!String.prototype.trimEnd;
var hasNativeIsSafeInteger = !!Number.isSafeInteger;
var isSafeInteger = hasNativeIsSafeInteger
    ? Number.isSafeInteger
    : function (n) {
        return (typeof n === 'number' &&
            isFinite(n) &&
            Math.floor(n) === n &&
            Math.abs(n) <= 0x1fffffffffffff);
    };
// IE11 does not support y and u.
var REGEX_SUPPORTS_U_AND_Y = true;
try {
    var re = RE('([^\\p{White_Space}\\p{Pattern_Syntax}]*)', 'yu');
    /**
     * legacy Edge or Xbox One browser
     * Unicode flag support: supported
     * Pattern_Syntax support: not supported
     * See https://github.com/formatjs/formatjs/issues/2822
     */
    REGEX_SUPPORTS_U_AND_Y = ((_a = re.exec('a')) === null || _a === void 0 ? void 0 : _a[0]) === 'a';
}
catch (_) {
    REGEX_SUPPORTS_U_AND_Y = false;
}
var startsWith = hasNativeStartsWith
    ? // Native
        function startsWith(s, search, position) {
            return s.startsWith(search, position);
        }
    : // For IE11
        function startsWith(s, search, position) {
            return s.slice(position, position + search.length) === search;
        };
var fromCodePoint = hasNativeFromCodePoint
    ? String.fromCodePoint
    : // IE11
        function fromCodePoint() {
            var codePoints = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                codePoints[_i] = arguments[_i];
            }
            var elements = '';
            var length = codePoints.length;
            var i = 0;
            var code;
            while (length > i) {
                code = codePoints[i++];
                if (code > 0x10ffff)
                    throw RangeError(code + ' is not a valid code point');
                elements +=
                    code < 0x10000
                        ? String.fromCharCode(code)
                        : String.fromCharCode(((code -= 0x10000) >> 10) + 0xd800, (code % 0x400) + 0xdc00);
            }
            return elements;
        };
var fromEntries = 
// native
hasNativeFromEntries
    ? Object.fromEntries
    : // Ponyfill
        function fromEntries(entries) {
            var obj = {};
            for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                var _a = entries_1[_i], k = _a[0], v = _a[1];
                obj[k] = v;
            }
            return obj;
        };
var codePointAt = hasNativeCodePointAt
    ? // Native
        function codePointAt(s, index) {
            return s.codePointAt(index);
        }
    : // IE 11
        function codePointAt(s, index) {
            var size = s.length;
            if (index < 0 || index >= size) {
                return undefined;
            }
            var first = s.charCodeAt(index);
            var second;
            return first < 0xd800 ||
                first > 0xdbff ||
                index + 1 === size ||
                (second = s.charCodeAt(index + 1)) < 0xdc00 ||
                second > 0xdfff
                ? first
                : ((first - 0xd800) << 10) + (second - 0xdc00) + 0x10000;
        };
var trimStart = hasTrimStart
    ? // Native
        function trimStart(s) {
            return s.trimStart();
        }
    : // Ponyfill
        function trimStart(s) {
            return s.replace(SPACE_SEPARATOR_START_REGEX, '');
        };
var trimEnd = hasTrimEnd
    ? // Native
        function trimEnd(s) {
            return s.trimEnd();
        }
    : // Ponyfill
        function trimEnd(s) {
            return s.replace(SPACE_SEPARATOR_END_REGEX, '');
        };
// Prevent minifier to translate new RegExp to literal form that might cause syntax error on IE11.
function RE(s, flag) {
    return new RegExp(s, flag);
}
// #endregion
var matchIdentifierAtIndex;
if (REGEX_SUPPORTS_U_AND_Y) {
    // Native
    var IDENTIFIER_PREFIX_RE_1 = RE('([^\\p{White_Space}\\p{Pattern_Syntax}]*)', 'yu');
    matchIdentifierAtIndex = function matchIdentifierAtIndex(s, index) {
        var _a;
        IDENTIFIER_PREFIX_RE_1.lastIndex = index;
        var match = IDENTIFIER_PREFIX_RE_1.exec(s);
        return (_a = match[1]) !== null && _a !== void 0 ? _a : '';
    };
}
else {
    // IE11
    matchIdentifierAtIndex = function matchIdentifierAtIndex(s, index) {
        var match = [];
        while (true) {
            var c = codePointAt(s, index);
            if (c === undefined || _isWhiteSpace(c) || _isPatternSyntax(c)) {
                break;
            }
            match.push(c);
            index += c >= 0x10000 ? 2 : 1;
        }
        return fromCodePoint.apply(void 0, match);
    };
}
var Parser = /** @class */ (function () {
    function Parser(message, options) {
        if (options === void 0) { options = {}; }
        this.message = message;
        this.position = { offset: 0, line: 1, column: 1 };
        this.ignoreTag = !!options.ignoreTag;
        this.locale = options.locale;
        this.requiresOtherClause = !!options.requiresOtherClause;
        this.shouldParseSkeletons = !!options.shouldParseSkeletons;
    }
    Parser.prototype.parse = function () {
        if (this.offset() !== 0) {
            throw Error('parser can only be used once');
        }
        return this.parseMessage(0, '', false);
    };
    Parser.prototype.parseMessage = function (nestingLevel, parentArgType, expectingCloseTag) {
        var elements = [];
        while (!this.isEOF()) {
            var char = this.char();
            if (char === 123 /* `{` */) {
                var result = this.parseArgument(nestingLevel, expectingCloseTag);
                if (result.err) {
                    return result;
                }
                elements.push(result.val);
            }
            else if (char === 125 /* `}` */ && nestingLevel > 0) {
                break;
            }
            else if (char === 35 /* `#` */ &&
                (parentArgType === 'plural' || parentArgType === 'selectordinal')) {
                var position = this.clonePosition();
                this.bump();
                elements.push({
                    type: TYPE.pound,
                    location: createLocation(position, this.clonePosition()),
                });
            }
            else if (char === 60 /* `<` */ &&
                !this.ignoreTag &&
                this.peek() === 47 // char code for '/'
            ) {
                if (expectingCloseTag) {
                    break;
                }
                else {
                    return this.error(ErrorKind.UNMATCHED_CLOSING_TAG, createLocation(this.clonePosition(), this.clonePosition()));
                }
            }
            else if (char === 60 /* `<` */ &&
                !this.ignoreTag &&
                _isAlpha(this.peek() || 0)) {
                var result = this.parseTag(nestingLevel, parentArgType);
                if (result.err) {
                    return result;
                }
                elements.push(result.val);
            }
            else {
                var result = this.parseLiteral(nestingLevel, parentArgType);
                if (result.err) {
                    return result;
                }
                elements.push(result.val);
            }
        }
        return { val: elements, err: null };
    };
    /**
     * A tag name must start with an ASCII lower/upper case letter. The grammar is based on the
     * [custom element name][] except that a dash is NOT always mandatory and uppercase letters
     * are accepted:
     *
     * ```
     * tag ::= "<" tagName (whitespace)* "/>" | "<" tagName (whitespace)* ">" message "</" tagName (whitespace)* ">"
     * tagName ::= [a-z] (PENChar)*
     * PENChar ::=
     *     "-" | "." | [0-9] | "_" | [a-z] | [A-Z] | #xB7 | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x37D] |
     *     [#x37F-#x1FFF] | [#x200C-#x200D] | [#x203F-#x2040] | [#x2070-#x218F] | [#x2C00-#x2FEF] |
     *     [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
     * ```
     *
     * [custom element name]: https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
     * NOTE: We're a bit more lax here since HTML technically does not allow uppercase HTML element but we do
     * since other tag-based engines like React allow it
     */
    Parser.prototype.parseTag = function (nestingLevel, parentArgType) {
        var startPosition = this.clonePosition();
        this.bump(); // `<`
        var tagName = this.parseTagName();
        this.bumpSpace();
        if (this.bumpIf('/>')) {
            // Self closing tag
            return {
                val: {
                    type: TYPE.literal,
                    value: "<".concat(tagName, "/>"),
                    location: createLocation(startPosition, this.clonePosition()),
                },
                err: null,
            };
        }
        else if (this.bumpIf('>')) {
            var childrenResult = this.parseMessage(nestingLevel + 1, parentArgType, true);
            if (childrenResult.err) {
                return childrenResult;
            }
            var children = childrenResult.val;
            // Expecting a close tag
            var endTagStartPosition = this.clonePosition();
            if (this.bumpIf('</')) {
                if (this.isEOF() || !_isAlpha(this.char())) {
                    return this.error(ErrorKind.INVALID_TAG, createLocation(endTagStartPosition, this.clonePosition()));
                }
                var closingTagNameStartPosition = this.clonePosition();
                var closingTagName = this.parseTagName();
                if (tagName !== closingTagName) {
                    return this.error(ErrorKind.UNMATCHED_CLOSING_TAG, createLocation(closingTagNameStartPosition, this.clonePosition()));
                }
                this.bumpSpace();
                if (!this.bumpIf('>')) {
                    return this.error(ErrorKind.INVALID_TAG, createLocation(endTagStartPosition, this.clonePosition()));
                }
                return {
                    val: {
                        type: TYPE.tag,
                        value: tagName,
                        children: children,
                        location: createLocation(startPosition, this.clonePosition()),
                    },
                    err: null,
                };
            }
            else {
                return this.error(ErrorKind.UNCLOSED_TAG, createLocation(startPosition, this.clonePosition()));
            }
        }
        else {
            return this.error(ErrorKind.INVALID_TAG, createLocation(startPosition, this.clonePosition()));
        }
    };
    /**
     * This method assumes that the caller has peeked ahead for the first tag character.
     */
    Parser.prototype.parseTagName = function () {
        var startOffset = this.offset();
        this.bump(); // the first tag name character
        while (!this.isEOF() && _isPotentialElementNameChar(this.char())) {
            this.bump();
        }
        return this.message.slice(startOffset, this.offset());
    };
    Parser.prototype.parseLiteral = function (nestingLevel, parentArgType) {
        var start = this.clonePosition();
        var value = '';
        while (true) {
            var parseQuoteResult = this.tryParseQuote(parentArgType);
            if (parseQuoteResult) {
                value += parseQuoteResult;
                continue;
            }
            var parseUnquotedResult = this.tryParseUnquoted(nestingLevel, parentArgType);
            if (parseUnquotedResult) {
                value += parseUnquotedResult;
                continue;
            }
            var parseLeftAngleResult = this.tryParseLeftAngleBracket();
            if (parseLeftAngleResult) {
                value += parseLeftAngleResult;
                continue;
            }
            break;
        }
        var location = createLocation(start, this.clonePosition());
        return {
            val: { type: TYPE.literal, value: value, location: location },
            err: null,
        };
    };
    Parser.prototype.tryParseLeftAngleBracket = function () {
        if (!this.isEOF() &&
            this.char() === 60 /* `<` */ &&
            (this.ignoreTag ||
                // If at the opening tag or closing tag position, bail.
                !_isAlphaOrSlash(this.peek() || 0))) {
            this.bump(); // `<`
            return '<';
        }
        return null;
    };
    /**
     * Starting with ICU 4.8, an ASCII apostrophe only starts quoted text if it immediately precedes
     * a character that requires quoting (that is, "only where needed"), and works the same in
     * nested messages as on the top level of the pattern. The new behavior is otherwise compatible.
     */
    Parser.prototype.tryParseQuote = function (parentArgType) {
        if (this.isEOF() || this.char() !== 39 /* `'` */) {
            return null;
        }
        // Parse escaped char following the apostrophe, or early return if there is no escaped char.
        // Check if is valid escaped character
        switch (this.peek()) {
            case 39 /* `'` */:
                // double quote, should return as a single quote.
                this.bump();
                this.bump();
                return "'";
            // '{', '<', '>', '}'
            case 123:
            case 60:
            case 62:
            case 125:
                break;
            case 35: // '#'
                if (parentArgType === 'plural' || parentArgType === 'selectordinal') {
                    break;
                }
                return null;
            default:
                return null;
        }
        this.bump(); // apostrophe
        var codePoints = [this.char()]; // escaped char
        this.bump();
        // read chars until the optional closing apostrophe is found
        while (!this.isEOF()) {
            var ch = this.char();
            if (ch === 39 /* `'` */) {
                if (this.peek() === 39 /* `'` */) {
                    codePoints.push(39);
                    // Bump one more time because we need to skip 2 characters.
                    this.bump();
                }
                else {
                    // Optional closing apostrophe.
                    this.bump();
                    break;
                }
            }
            else {
                codePoints.push(ch);
            }
            this.bump();
        }
        return fromCodePoint.apply(void 0, codePoints);
    };
    Parser.prototype.tryParseUnquoted = function (nestingLevel, parentArgType) {
        if (this.isEOF()) {
            return null;
        }
        var ch = this.char();
        if (ch === 60 /* `<` */ ||
            ch === 123 /* `{` */ ||
            (ch === 35 /* `#` */ &&
                (parentArgType === 'plural' || parentArgType === 'selectordinal')) ||
            (ch === 125 /* `}` */ && nestingLevel > 0)) {
            return null;
        }
        else {
            this.bump();
            return fromCodePoint(ch);
        }
    };
    Parser.prototype.parseArgument = function (nestingLevel, expectingCloseTag) {
        var openingBracePosition = this.clonePosition();
        this.bump(); // `{`
        this.bumpSpace();
        if (this.isEOF()) {
            return this.error(ErrorKind.EXPECT_ARGUMENT_CLOSING_BRACE, createLocation(openingBracePosition, this.clonePosition()));
        }
        if (this.char() === 125 /* `}` */) {
            this.bump();
            return this.error(ErrorKind.EMPTY_ARGUMENT, createLocation(openingBracePosition, this.clonePosition()));
        }
        // argument name
        var value = this.parseIdentifierIfPossible().value;
        if (!value) {
            return this.error(ErrorKind.MALFORMED_ARGUMENT, createLocation(openingBracePosition, this.clonePosition()));
        }
        this.bumpSpace();
        if (this.isEOF()) {
            return this.error(ErrorKind.EXPECT_ARGUMENT_CLOSING_BRACE, createLocation(openingBracePosition, this.clonePosition()));
        }
        switch (this.char()) {
            // Simple argument: `{name}`
            case 125 /* `}` */: {
                this.bump(); // `}`
                return {
                    val: {
                        type: TYPE.argument,
                        // value does not include the opening and closing braces.
                        value: value,
                        location: createLocation(openingBracePosition, this.clonePosition()),
                    },
                    err: null,
                };
            }
            // Argument with options: `{name, format, ...}`
            case 44 /* `,` */: {
                this.bump(); // `,`
                this.bumpSpace();
                if (this.isEOF()) {
                    return this.error(ErrorKind.EXPECT_ARGUMENT_CLOSING_BRACE, createLocation(openingBracePosition, this.clonePosition()));
                }
                return this.parseArgumentOptions(nestingLevel, expectingCloseTag, value, openingBracePosition);
            }
            default:
                return this.error(ErrorKind.MALFORMED_ARGUMENT, createLocation(openingBracePosition, this.clonePosition()));
        }
    };
    /**
     * Advance the parser until the end of the identifier, if it is currently on
     * an identifier character. Return an empty string otherwise.
     */
    Parser.prototype.parseIdentifierIfPossible = function () {
        var startingPosition = this.clonePosition();
        var startOffset = this.offset();
        var value = matchIdentifierAtIndex(this.message, startOffset);
        var endOffset = startOffset + value.length;
        this.bumpTo(endOffset);
        var endPosition = this.clonePosition();
        var location = createLocation(startingPosition, endPosition);
        return { value: value, location: location };
    };
    Parser.prototype.parseArgumentOptions = function (nestingLevel, expectingCloseTag, value, openingBracePosition) {
        var _a;
        // Parse this range:
        // {name, type, style}
        //        ^---^
        var typeStartPosition = this.clonePosition();
        var argType = this.parseIdentifierIfPossible().value;
        var typeEndPosition = this.clonePosition();
        switch (argType) {
            case '':
                // Expecting a style string number, date, time, plural, selectordinal, or select.
                return this.error(ErrorKind.EXPECT_ARGUMENT_TYPE, createLocation(typeStartPosition, typeEndPosition));
            case 'number':
            case 'date':
            case 'time': {
                // Parse this range:
                // {name, number, style}
                //              ^-------^
                this.bumpSpace();
                var styleAndLocation = null;
                if (this.bumpIf(',')) {
                    this.bumpSpace();
                    var styleStartPosition = this.clonePosition();
                    var result = this.parseSimpleArgStyleIfPossible();
                    if (result.err) {
                        return result;
                    }
                    var style = trimEnd(result.val);
                    if (style.length === 0) {
                        return this.error(ErrorKind.EXPECT_ARGUMENT_STYLE, createLocation(this.clonePosition(), this.clonePosition()));
                    }
                    var styleLocation = createLocation(styleStartPosition, this.clonePosition());
                    styleAndLocation = { style: style, styleLocation: styleLocation };
                }
                var argCloseResult = this.tryParseArgumentClose(openingBracePosition);
                if (argCloseResult.err) {
                    return argCloseResult;
                }
                var location_1 = createLocation(openingBracePosition, this.clonePosition());
                // Extract style or skeleton
                if (styleAndLocation && startsWith(styleAndLocation === null || styleAndLocation === void 0 ? void 0 : styleAndLocation.style, '::', 0)) {
                    // Skeleton starts with `::`.
                    var skeleton = trimStart(styleAndLocation.style.slice(2));
                    if (argType === 'number') {
                        var result = this.parseNumberSkeletonFromString(skeleton, styleAndLocation.styleLocation);
                        if (result.err) {
                            return result;
                        }
                        return {
                            val: { type: TYPE.number, value: value, location: location_1, style: result.val },
                            err: null,
                        };
                    }
                    else {
                        if (skeleton.length === 0) {
                            return this.error(ErrorKind.EXPECT_DATE_TIME_SKELETON, location_1);
                        }
                        var dateTimePattern = skeleton;
                        // Get "best match" pattern only if locale is passed, if not, let it
                        // pass as-is where `parseDateTimeSkeleton()` will throw an error
                        // for unsupported patterns.
                        if (this.locale) {
                            dateTimePattern = getBestPattern(skeleton, this.locale);
                        }
                        var style = {
                            type: SKELETON_TYPE.dateTime,
                            pattern: dateTimePattern,
                            location: styleAndLocation.styleLocation,
                            parsedOptions: this.shouldParseSkeletons
                                ? parseDateTimeSkeleton(dateTimePattern)
                                : {},
                        };
                        var type = argType === 'date' ? TYPE.date : TYPE.time;
                        return {
                            val: { type: type, value: value, location: location_1, style: style },
                            err: null,
                        };
                    }
                }
                // Regular style or no style.
                return {
                    val: {
                        type: argType === 'number'
                            ? TYPE.number
                            : argType === 'date'
                                ? TYPE.date
                                : TYPE.time,
                        value: value,
                        location: location_1,
                        style: (_a = styleAndLocation === null || styleAndLocation === void 0 ? void 0 : styleAndLocation.style) !== null && _a !== void 0 ? _a : null,
                    },
                    err: null,
                };
            }
            case 'plural':
            case 'selectordinal':
            case 'select': {
                // Parse this range:
                // {name, plural, options}
                //              ^---------^
                var typeEndPosition_1 = this.clonePosition();
                this.bumpSpace();
                if (!this.bumpIf(',')) {
                    return this.error(ErrorKind.EXPECT_SELECT_ARGUMENT_OPTIONS, createLocation(typeEndPosition_1, __assign({}, typeEndPosition_1)));
                }
                this.bumpSpace();
                // Parse offset:
                // {name, plural, offset:1, options}
                //                ^-----^
                //
                // or the first option:
                //
                // {name, plural, one {...} other {...}}
                //                ^--^
                var identifierAndLocation = this.parseIdentifierIfPossible();
                var pluralOffset = 0;
                if (argType !== 'select' && identifierAndLocation.value === 'offset') {
                    if (!this.bumpIf(':')) {
                        return this.error(ErrorKind.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE, createLocation(this.clonePosition(), this.clonePosition()));
                    }
                    this.bumpSpace();
                    var result = this.tryParseDecimalInteger(ErrorKind.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE, ErrorKind.INVALID_PLURAL_ARGUMENT_OFFSET_VALUE);
                    if (result.err) {
                        return result;
                    }
                    // Parse another identifier for option parsing
                    this.bumpSpace();
                    identifierAndLocation = this.parseIdentifierIfPossible();
                    pluralOffset = result.val;
                }
                var optionsResult = this.tryParsePluralOrSelectOptions(nestingLevel, argType, expectingCloseTag, identifierAndLocation);
                if (optionsResult.err) {
                    return optionsResult;
                }
                var argCloseResult = this.tryParseArgumentClose(openingBracePosition);
                if (argCloseResult.err) {
                    return argCloseResult;
                }
                var location_2 = createLocation(openingBracePosition, this.clonePosition());
                if (argType === 'select') {
                    return {
                        val: {
                            type: TYPE.select,
                            value: value,
                            options: fromEntries(optionsResult.val),
                            location: location_2,
                        },
                        err: null,
                    };
                }
                else {
                    return {
                        val: {
                            type: TYPE.plural,
                            value: value,
                            options: fromEntries(optionsResult.val),
                            offset: pluralOffset,
                            pluralType: argType === 'plural' ? 'cardinal' : 'ordinal',
                            location: location_2,
                        },
                        err: null,
                    };
                }
            }
            default:
                return this.error(ErrorKind.INVALID_ARGUMENT_TYPE, createLocation(typeStartPosition, typeEndPosition));
        }
    };
    Parser.prototype.tryParseArgumentClose = function (openingBracePosition) {
        // Parse: {value, number, ::currency/GBP }
        //
        if (this.isEOF() || this.char() !== 125 /* `}` */) {
            return this.error(ErrorKind.EXPECT_ARGUMENT_CLOSING_BRACE, createLocation(openingBracePosition, this.clonePosition()));
        }
        this.bump(); // `}`
        return { val: true, err: null };
    };
    /**
     * See: https://github.com/unicode-org/icu/blob/af7ed1f6d2298013dc303628438ec4abe1f16479/icu4c/source/common/messagepattern.cpp#L659
     */
    Parser.prototype.parseSimpleArgStyleIfPossible = function () {
        var nestedBraces = 0;
        var startPosition = this.clonePosition();
        while (!this.isEOF()) {
            var ch = this.char();
            switch (ch) {
                case 39 /* `'` */: {
                    // Treat apostrophe as quoting but include it in the style part.
                    // Find the end of the quoted literal text.
                    this.bump();
                    var apostrophePosition = this.clonePosition();
                    if (!this.bumpUntil("'")) {
                        return this.error(ErrorKind.UNCLOSED_QUOTE_IN_ARGUMENT_STYLE, createLocation(apostrophePosition, this.clonePosition()));
                    }
                    this.bump();
                    break;
                }
                case 123 /* `{` */: {
                    nestedBraces += 1;
                    this.bump();
                    break;
                }
                case 125 /* `}` */: {
                    if (nestedBraces > 0) {
                        nestedBraces -= 1;
                    }
                    else {
                        return {
                            val: this.message.slice(startPosition.offset, this.offset()),
                            err: null,
                        };
                    }
                    break;
                }
                default:
                    this.bump();
                    break;
            }
        }
        return {
            val: this.message.slice(startPosition.offset, this.offset()),
            err: null,
        };
    };
    Parser.prototype.parseNumberSkeletonFromString = function (skeleton, location) {
        var tokens = [];
        try {
            tokens = parseNumberSkeletonFromString(skeleton);
        }
        catch (e) {
            return this.error(ErrorKind.INVALID_NUMBER_SKELETON, location);
        }
        return {
            val: {
                type: SKELETON_TYPE.number,
                tokens: tokens,
                location: location,
                parsedOptions: this.shouldParseSkeletons
                    ? parseNumberSkeleton(tokens)
                    : {},
            },
            err: null,
        };
    };
    /**
     * @param nesting_level The current nesting level of messages.
     *     This can be positive when parsing message fragment in select or plural argument options.
     * @param parent_arg_type The parent argument's type.
     * @param parsed_first_identifier If provided, this is the first identifier-like selector of
     *     the argument. It is a by-product of a previous parsing attempt.
     * @param expecting_close_tag If true, this message is directly or indirectly nested inside
     *     between a pair of opening and closing tags. The nested message will not parse beyond
     *     the closing tag boundary.
     */
    Parser.prototype.tryParsePluralOrSelectOptions = function (nestingLevel, parentArgType, expectCloseTag, parsedFirstIdentifier) {
        var _a;
        var hasOtherClause = false;
        var options = [];
        var parsedSelectors = new Set();
        var selector = parsedFirstIdentifier.value, selectorLocation = parsedFirstIdentifier.location;
        // Parse:
        // one {one apple}
        // ^--^
        while (true) {
            if (selector.length === 0) {
                var startPosition = this.clonePosition();
                if (parentArgType !== 'select' && this.bumpIf('=')) {
                    // Try parse `={number}` selector
                    var result = this.tryParseDecimalInteger(ErrorKind.EXPECT_PLURAL_ARGUMENT_SELECTOR, ErrorKind.INVALID_PLURAL_ARGUMENT_SELECTOR);
                    if (result.err) {
                        return result;
                    }
                    selectorLocation = createLocation(startPosition, this.clonePosition());
                    selector = this.message.slice(startPosition.offset, this.offset());
                }
                else {
                    break;
                }
            }
            // Duplicate selector clauses
            if (parsedSelectors.has(selector)) {
                return this.error(parentArgType === 'select'
                    ? ErrorKind.DUPLICATE_SELECT_ARGUMENT_SELECTOR
                    : ErrorKind.DUPLICATE_PLURAL_ARGUMENT_SELECTOR, selectorLocation);
            }
            if (selector === 'other') {
                hasOtherClause = true;
            }
            // Parse:
            // one {one apple}
            //     ^----------^
            this.bumpSpace();
            var openingBracePosition = this.clonePosition();
            if (!this.bumpIf('{')) {
                return this.error(parentArgType === 'select'
                    ? ErrorKind.EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT
                    : ErrorKind.EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT, createLocation(this.clonePosition(), this.clonePosition()));
            }
            var fragmentResult = this.parseMessage(nestingLevel + 1, parentArgType, expectCloseTag);
            if (fragmentResult.err) {
                return fragmentResult;
            }
            var argCloseResult = this.tryParseArgumentClose(openingBracePosition);
            if (argCloseResult.err) {
                return argCloseResult;
            }
            options.push([
                selector,
                {
                    value: fragmentResult.val,
                    location: createLocation(openingBracePosition, this.clonePosition()),
                },
            ]);
            // Keep track of the existing selectors
            parsedSelectors.add(selector);
            // Prep next selector clause.
            this.bumpSpace();
            (_a = this.parseIdentifierIfPossible(), selector = _a.value, selectorLocation = _a.location);
        }
        if (options.length === 0) {
            return this.error(parentArgType === 'select'
                ? ErrorKind.EXPECT_SELECT_ARGUMENT_SELECTOR
                : ErrorKind.EXPECT_PLURAL_ARGUMENT_SELECTOR, createLocation(this.clonePosition(), this.clonePosition()));
        }
        if (this.requiresOtherClause && !hasOtherClause) {
            return this.error(ErrorKind.MISSING_OTHER_CLAUSE, createLocation(this.clonePosition(), this.clonePosition()));
        }
        return { val: options, err: null };
    };
    Parser.prototype.tryParseDecimalInteger = function (expectNumberError, invalidNumberError) {
        var sign = 1;
        var startingPosition = this.clonePosition();
        if (this.bumpIf('+')) ;
        else if (this.bumpIf('-')) {
            sign = -1;
        }
        var hasDigits = false;
        var decimal = 0;
        while (!this.isEOF()) {
            var ch = this.char();
            if (ch >= 48 /* `0` */ && ch <= 57 /* `9` */) {
                hasDigits = true;
                decimal = decimal * 10 + (ch - 48);
                this.bump();
            }
            else {
                break;
            }
        }
        var location = createLocation(startingPosition, this.clonePosition());
        if (!hasDigits) {
            return this.error(expectNumberError, location);
        }
        decimal *= sign;
        if (!isSafeInteger(decimal)) {
            return this.error(invalidNumberError, location);
        }
        return { val: decimal, err: null };
    };
    Parser.prototype.offset = function () {
        return this.position.offset;
    };
    Parser.prototype.isEOF = function () {
        return this.offset() === this.message.length;
    };
    Parser.prototype.clonePosition = function () {
        // This is much faster than `Object.assign` or spread.
        return {
            offset: this.position.offset,
            line: this.position.line,
            column: this.position.column,
        };
    };
    /**
     * Return the code point at the current position of the parser.
     * Throws if the index is out of bound.
     */
    Parser.prototype.char = function () {
        var offset = this.position.offset;
        if (offset >= this.message.length) {
            throw Error('out of bound');
        }
        var code = codePointAt(this.message, offset);
        if (code === undefined) {
            throw Error("Offset ".concat(offset, " is at invalid UTF-16 code unit boundary"));
        }
        return code;
    };
    Parser.prototype.error = function (kind, location) {
        return {
            val: null,
            err: {
                kind: kind,
                message: this.message,
                location: location,
            },
        };
    };
    /** Bump the parser to the next UTF-16 code unit. */
    Parser.prototype.bump = function () {
        if (this.isEOF()) {
            return;
        }
        var code = this.char();
        if (code === 10 /* '\n' */) {
            this.position.line += 1;
            this.position.column = 1;
            this.position.offset += 1;
        }
        else {
            this.position.column += 1;
            // 0 ~ 0x10000 -> unicode BMP, otherwise skip the surrogate pair.
            this.position.offset += code < 0x10000 ? 1 : 2;
        }
    };
    /**
     * If the substring starting at the current position of the parser has
     * the given prefix, then bump the parser to the character immediately
     * following the prefix and return true. Otherwise, don't bump the parser
     * and return false.
     */
    Parser.prototype.bumpIf = function (prefix) {
        if (startsWith(this.message, prefix, this.offset())) {
            for (var i = 0; i < prefix.length; i++) {
                this.bump();
            }
            return true;
        }
        return false;
    };
    /**
     * Bump the parser until the pattern character is found and return `true`.
     * Otherwise bump to the end of the file and return `false`.
     */
    Parser.prototype.bumpUntil = function (pattern) {
        var currentOffset = this.offset();
        var index = this.message.indexOf(pattern, currentOffset);
        if (index >= 0) {
            this.bumpTo(index);
            return true;
        }
        else {
            this.bumpTo(this.message.length);
            return false;
        }
    };
    /**
     * Bump the parser to the target offset.
     * If target offset is beyond the end of the input, bump the parser to the end of the input.
     */
    Parser.prototype.bumpTo = function (targetOffset) {
        if (this.offset() > targetOffset) {
            throw Error("targetOffset ".concat(targetOffset, " must be greater than or equal to the current offset ").concat(this.offset()));
        }
        targetOffset = Math.min(targetOffset, this.message.length);
        while (true) {
            var offset = this.offset();
            if (offset === targetOffset) {
                break;
            }
            if (offset > targetOffset) {
                throw Error("targetOffset ".concat(targetOffset, " is at invalid UTF-16 code unit boundary"));
            }
            this.bump();
            if (this.isEOF()) {
                break;
            }
        }
    };
    /** advance the parser through all whitespace to the next non-whitespace code unit. */
    Parser.prototype.bumpSpace = function () {
        while (!this.isEOF() && _isWhiteSpace(this.char())) {
            this.bump();
        }
    };
    /**
     * Peek at the *next* Unicode codepoint in the input without advancing the parser.
     * If the input has been exhausted, then this returns null.
     */
    Parser.prototype.peek = function () {
        if (this.isEOF()) {
            return null;
        }
        var code = this.char();
        var offset = this.offset();
        var nextCode = this.message.charCodeAt(offset + (code >= 0x10000 ? 2 : 1));
        return nextCode !== null && nextCode !== void 0 ? nextCode : null;
    };
    return Parser;
}());
/**
 * This check if codepoint is alphabet (lower & uppercase)
 * @param codepoint
 * @returns
 */
function _isAlpha(codepoint) {
    return ((codepoint >= 97 && codepoint <= 122) ||
        (codepoint >= 65 && codepoint <= 90));
}
function _isAlphaOrSlash(codepoint) {
    return _isAlpha(codepoint) || codepoint === 47; /* '/' */
}
/** See `parseTag` function docs. */
function _isPotentialElementNameChar(c) {
    return (c === 45 /* '-' */ ||
        c === 46 /* '.' */ ||
        (c >= 48 && c <= 57) /* 0..9 */ ||
        c === 95 /* '_' */ ||
        (c >= 97 && c <= 122) /** a..z */ ||
        (c >= 65 && c <= 90) /* A..Z */ ||
        c == 0xb7 ||
        (c >= 0xc0 && c <= 0xd6) ||
        (c >= 0xd8 && c <= 0xf6) ||
        (c >= 0xf8 && c <= 0x37d) ||
        (c >= 0x37f && c <= 0x1fff) ||
        (c >= 0x200c && c <= 0x200d) ||
        (c >= 0x203f && c <= 0x2040) ||
        (c >= 0x2070 && c <= 0x218f) ||
        (c >= 0x2c00 && c <= 0x2fef) ||
        (c >= 0x3001 && c <= 0xd7ff) ||
        (c >= 0xf900 && c <= 0xfdcf) ||
        (c >= 0xfdf0 && c <= 0xfffd) ||
        (c >= 0x10000 && c <= 0xeffff));
}
/**
 * Code point equivalent of regex `\p{White_Space}`.
 * From: https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt
 */
function _isWhiteSpace(c) {
    return ((c >= 0x0009 && c <= 0x000d) ||
        c === 0x0020 ||
        c === 0x0085 ||
        (c >= 0x200e && c <= 0x200f) ||
        c === 0x2028 ||
        c === 0x2029);
}
/**
 * Code point equivalent of regex `\p{Pattern_Syntax}`.
 * See https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt
 */
function _isPatternSyntax(c) {
    return ((c >= 0x0021 && c <= 0x0023) ||
        c === 0x0024 ||
        (c >= 0x0025 && c <= 0x0027) ||
        c === 0x0028 ||
        c === 0x0029 ||
        c === 0x002a ||
        c === 0x002b ||
        c === 0x002c ||
        c === 0x002d ||
        (c >= 0x002e && c <= 0x002f) ||
        (c >= 0x003a && c <= 0x003b) ||
        (c >= 0x003c && c <= 0x003e) ||
        (c >= 0x003f && c <= 0x0040) ||
        c === 0x005b ||
        c === 0x005c ||
        c === 0x005d ||
        c === 0x005e ||
        c === 0x0060 ||
        c === 0x007b ||
        c === 0x007c ||
        c === 0x007d ||
        c === 0x007e ||
        c === 0x00a1 ||
        (c >= 0x00a2 && c <= 0x00a5) ||
        c === 0x00a6 ||
        c === 0x00a7 ||
        c === 0x00a9 ||
        c === 0x00ab ||
        c === 0x00ac ||
        c === 0x00ae ||
        c === 0x00b0 ||
        c === 0x00b1 ||
        c === 0x00b6 ||
        c === 0x00bb ||
        c === 0x00bf ||
        c === 0x00d7 ||
        c === 0x00f7 ||
        (c >= 0x2010 && c <= 0x2015) ||
        (c >= 0x2016 && c <= 0x2017) ||
        c === 0x2018 ||
        c === 0x2019 ||
        c === 0x201a ||
        (c >= 0x201b && c <= 0x201c) ||
        c === 0x201d ||
        c === 0x201e ||
        c === 0x201f ||
        (c >= 0x2020 && c <= 0x2027) ||
        (c >= 0x2030 && c <= 0x2038) ||
        c === 0x2039 ||
        c === 0x203a ||
        (c >= 0x203b && c <= 0x203e) ||
        (c >= 0x2041 && c <= 0x2043) ||
        c === 0x2044 ||
        c === 0x2045 ||
        c === 0x2046 ||
        (c >= 0x2047 && c <= 0x2051) ||
        c === 0x2052 ||
        c === 0x2053 ||
        (c >= 0x2055 && c <= 0x205e) ||
        (c >= 0x2190 && c <= 0x2194) ||
        (c >= 0x2195 && c <= 0x2199) ||
        (c >= 0x219a && c <= 0x219b) ||
        (c >= 0x219c && c <= 0x219f) ||
        c === 0x21a0 ||
        (c >= 0x21a1 && c <= 0x21a2) ||
        c === 0x21a3 ||
        (c >= 0x21a4 && c <= 0x21a5) ||
        c === 0x21a6 ||
        (c >= 0x21a7 && c <= 0x21ad) ||
        c === 0x21ae ||
        (c >= 0x21af && c <= 0x21cd) ||
        (c >= 0x21ce && c <= 0x21cf) ||
        (c >= 0x21d0 && c <= 0x21d1) ||
        c === 0x21d2 ||
        c === 0x21d3 ||
        c === 0x21d4 ||
        (c >= 0x21d5 && c <= 0x21f3) ||
        (c >= 0x21f4 && c <= 0x22ff) ||
        (c >= 0x2300 && c <= 0x2307) ||
        c === 0x2308 ||
        c === 0x2309 ||
        c === 0x230a ||
        c === 0x230b ||
        (c >= 0x230c && c <= 0x231f) ||
        (c >= 0x2320 && c <= 0x2321) ||
        (c >= 0x2322 && c <= 0x2328) ||
        c === 0x2329 ||
        c === 0x232a ||
        (c >= 0x232b && c <= 0x237b) ||
        c === 0x237c ||
        (c >= 0x237d && c <= 0x239a) ||
        (c >= 0x239b && c <= 0x23b3) ||
        (c >= 0x23b4 && c <= 0x23db) ||
        (c >= 0x23dc && c <= 0x23e1) ||
        (c >= 0x23e2 && c <= 0x2426) ||
        (c >= 0x2427 && c <= 0x243f) ||
        (c >= 0x2440 && c <= 0x244a) ||
        (c >= 0x244b && c <= 0x245f) ||
        (c >= 0x2500 && c <= 0x25b6) ||
        c === 0x25b7 ||
        (c >= 0x25b8 && c <= 0x25c0) ||
        c === 0x25c1 ||
        (c >= 0x25c2 && c <= 0x25f7) ||
        (c >= 0x25f8 && c <= 0x25ff) ||
        (c >= 0x2600 && c <= 0x266e) ||
        c === 0x266f ||
        (c >= 0x2670 && c <= 0x2767) ||
        c === 0x2768 ||
        c === 0x2769 ||
        c === 0x276a ||
        c === 0x276b ||
        c === 0x276c ||
        c === 0x276d ||
        c === 0x276e ||
        c === 0x276f ||
        c === 0x2770 ||
        c === 0x2771 ||
        c === 0x2772 ||
        c === 0x2773 ||
        c === 0x2774 ||
        c === 0x2775 ||
        (c >= 0x2794 && c <= 0x27bf) ||
        (c >= 0x27c0 && c <= 0x27c4) ||
        c === 0x27c5 ||
        c === 0x27c6 ||
        (c >= 0x27c7 && c <= 0x27e5) ||
        c === 0x27e6 ||
        c === 0x27e7 ||
        c === 0x27e8 ||
        c === 0x27e9 ||
        c === 0x27ea ||
        c === 0x27eb ||
        c === 0x27ec ||
        c === 0x27ed ||
        c === 0x27ee ||
        c === 0x27ef ||
        (c >= 0x27f0 && c <= 0x27ff) ||
        (c >= 0x2800 && c <= 0x28ff) ||
        (c >= 0x2900 && c <= 0x2982) ||
        c === 0x2983 ||
        c === 0x2984 ||
        c === 0x2985 ||
        c === 0x2986 ||
        c === 0x2987 ||
        c === 0x2988 ||
        c === 0x2989 ||
        c === 0x298a ||
        c === 0x298b ||
        c === 0x298c ||
        c === 0x298d ||
        c === 0x298e ||
        c === 0x298f ||
        c === 0x2990 ||
        c === 0x2991 ||
        c === 0x2992 ||
        c === 0x2993 ||
        c === 0x2994 ||
        c === 0x2995 ||
        c === 0x2996 ||
        c === 0x2997 ||
        c === 0x2998 ||
        (c >= 0x2999 && c <= 0x29d7) ||
        c === 0x29d8 ||
        c === 0x29d9 ||
        c === 0x29da ||
        c === 0x29db ||
        (c >= 0x29dc && c <= 0x29fb) ||
        c === 0x29fc ||
        c === 0x29fd ||
        (c >= 0x29fe && c <= 0x2aff) ||
        (c >= 0x2b00 && c <= 0x2b2f) ||
        (c >= 0x2b30 && c <= 0x2b44) ||
        (c >= 0x2b45 && c <= 0x2b46) ||
        (c >= 0x2b47 && c <= 0x2b4c) ||
        (c >= 0x2b4d && c <= 0x2b73) ||
        (c >= 0x2b74 && c <= 0x2b75) ||
        (c >= 0x2b76 && c <= 0x2b95) ||
        c === 0x2b96 ||
        (c >= 0x2b97 && c <= 0x2bff) ||
        (c >= 0x2e00 && c <= 0x2e01) ||
        c === 0x2e02 ||
        c === 0x2e03 ||
        c === 0x2e04 ||
        c === 0x2e05 ||
        (c >= 0x2e06 && c <= 0x2e08) ||
        c === 0x2e09 ||
        c === 0x2e0a ||
        c === 0x2e0b ||
        c === 0x2e0c ||
        c === 0x2e0d ||
        (c >= 0x2e0e && c <= 0x2e16) ||
        c === 0x2e17 ||
        (c >= 0x2e18 && c <= 0x2e19) ||
        c === 0x2e1a ||
        c === 0x2e1b ||
        c === 0x2e1c ||
        c === 0x2e1d ||
        (c >= 0x2e1e && c <= 0x2e1f) ||
        c === 0x2e20 ||
        c === 0x2e21 ||
        c === 0x2e22 ||
        c === 0x2e23 ||
        c === 0x2e24 ||
        c === 0x2e25 ||
        c === 0x2e26 ||
        c === 0x2e27 ||
        c === 0x2e28 ||
        c === 0x2e29 ||
        (c >= 0x2e2a && c <= 0x2e2e) ||
        c === 0x2e2f ||
        (c >= 0x2e30 && c <= 0x2e39) ||
        (c >= 0x2e3a && c <= 0x2e3b) ||
        (c >= 0x2e3c && c <= 0x2e3f) ||
        c === 0x2e40 ||
        c === 0x2e41 ||
        c === 0x2e42 ||
        (c >= 0x2e43 && c <= 0x2e4f) ||
        (c >= 0x2e50 && c <= 0x2e51) ||
        c === 0x2e52 ||
        (c >= 0x2e53 && c <= 0x2e7f) ||
        (c >= 0x3001 && c <= 0x3003) ||
        c === 0x3008 ||
        c === 0x3009 ||
        c === 0x300a ||
        c === 0x300b ||
        c === 0x300c ||
        c === 0x300d ||
        c === 0x300e ||
        c === 0x300f ||
        c === 0x3010 ||
        c === 0x3011 ||
        (c >= 0x3012 && c <= 0x3013) ||
        c === 0x3014 ||
        c === 0x3015 ||
        c === 0x3016 ||
        c === 0x3017 ||
        c === 0x3018 ||
        c === 0x3019 ||
        c === 0x301a ||
        c === 0x301b ||
        c === 0x301c ||
        c === 0x301d ||
        (c >= 0x301e && c <= 0x301f) ||
        c === 0x3020 ||
        c === 0x3030 ||
        c === 0xfd3e ||
        c === 0xfd3f ||
        (c >= 0xfe45 && c <= 0xfe46));
}

function pruneLocation(els) {
    els.forEach(function (el) {
        delete el.location;
        if (isSelectElement(el) || isPluralElement(el)) {
            for (var k in el.options) {
                delete el.options[k].location;
                pruneLocation(el.options[k].value);
            }
        }
        else if (isNumberElement(el) && isNumberSkeleton(el.style)) {
            delete el.style.location;
        }
        else if ((isDateElement(el) || isTimeElement(el)) &&
            isDateTimeSkeleton(el.style)) {
            delete el.style.location;
        }
        else if (isTagElement(el)) {
            pruneLocation(el.children);
        }
    });
}
function parse(message, opts) {
    if (opts === void 0) { opts = {}; }
    opts = __assign({ shouldParseSkeletons: true, requiresOtherClause: true }, opts);
    var result = new Parser(message, opts).parse();
    if (result.err) {
        var error = SyntaxError(ErrorKind[result.err.kind]);
        // @ts-expect-error Assign to error object
        error.location = result.err.location;
        // @ts-expect-error Assign to error object
        error.originalMessage = result.err.message;
        throw error;
    }
    if (!(opts === null || opts === void 0 ? void 0 : opts.captureLocation)) {
        pruneLocation(result.val);
    }
    return result.val;
}

var ErrorCode;
(function (ErrorCode) {
    // When we have a placeholder but no value to format
    ErrorCode["MISSING_VALUE"] = "MISSING_VALUE";
    // When value supplied is invalid
    ErrorCode["INVALID_VALUE"] = "INVALID_VALUE";
    // When we need specific Intl API but it's not available
    ErrorCode["MISSING_INTL_API"] = "MISSING_INTL_API";
})(ErrorCode || (ErrorCode = {}));
var FormatError = /** @class */ (function (_super) {
    __extends(FormatError, _super);
    function FormatError(msg, code, originalMessage) {
        var _this = _super.call(this, msg) || this;
        _this.code = code;
        _this.originalMessage = originalMessage;
        return _this;
    }
    FormatError.prototype.toString = function () {
        return "[formatjs Error: ".concat(this.code, "] ").concat(this.message);
    };
    return FormatError;
}(Error));
var InvalidValueError = /** @class */ (function (_super) {
    __extends(InvalidValueError, _super);
    function InvalidValueError(variableId, value, options, originalMessage) {
        return _super.call(this, "Invalid values for \"".concat(variableId, "\": \"").concat(value, "\". Options are \"").concat(Object.keys(options).join('", "'), "\""), ErrorCode.INVALID_VALUE, originalMessage) || this;
    }
    return InvalidValueError;
}(FormatError));
var InvalidValueTypeError = /** @class */ (function (_super) {
    __extends(InvalidValueTypeError, _super);
    function InvalidValueTypeError(value, type, originalMessage) {
        return _super.call(this, "Value for \"".concat(value, "\" must be of type ").concat(type), ErrorCode.INVALID_VALUE, originalMessage) || this;
    }
    return InvalidValueTypeError;
}(FormatError));
var MissingValueError = /** @class */ (function (_super) {
    __extends(MissingValueError, _super);
    function MissingValueError(variableId, originalMessage) {
        return _super.call(this, "The intl string context variable \"".concat(variableId, "\" was not provided to the string \"").concat(originalMessage, "\""), ErrorCode.MISSING_VALUE, originalMessage) || this;
    }
    return MissingValueError;
}(FormatError));

var PART_TYPE;
(function (PART_TYPE) {
    PART_TYPE[PART_TYPE["literal"] = 0] = "literal";
    PART_TYPE[PART_TYPE["object"] = 1] = "object";
})(PART_TYPE || (PART_TYPE = {}));
function mergeLiteral(parts) {
    if (parts.length < 2) {
        return parts;
    }
    return parts.reduce(function (all, part) {
        var lastPart = all[all.length - 1];
        if (!lastPart ||
            lastPart.type !== PART_TYPE.literal ||
            part.type !== PART_TYPE.literal) {
            all.push(part);
        }
        else {
            lastPart.value += part.value;
        }
        return all;
    }, []);
}
function isFormatXMLElementFn(el) {
    return typeof el === 'function';
}
// TODO(skeleton): add skeleton support
function formatToParts(els, locales, formatters, formats, values, currentPluralValue, 
// For debugging
originalMessage) {
    // Hot path for straight simple msg translations
    if (els.length === 1 && isLiteralElement(els[0])) {
        return [
            {
                type: PART_TYPE.literal,
                value: els[0].value,
            },
        ];
    }
    var result = [];
    for (var _i = 0, els_1 = els; _i < els_1.length; _i++) {
        var el = els_1[_i];
        // Exit early for string parts.
        if (isLiteralElement(el)) {
            result.push({
                type: PART_TYPE.literal,
                value: el.value,
            });
            continue;
        }
        // TODO: should this part be literal type?
        // Replace `#` in plural rules with the actual numeric value.
        if (isPoundElement(el)) {
            if (typeof currentPluralValue === 'number') {
                result.push({
                    type: PART_TYPE.literal,
                    value: formatters.getNumberFormat(locales).format(currentPluralValue),
                });
            }
            continue;
        }
        var varName = el.value;
        // Enforce that all required values are provided by the caller.
        if (!(values && varName in values)) {
            throw new MissingValueError(varName, originalMessage);
        }
        var value = values[varName];
        if (isArgumentElement(el)) {
            if (!value || typeof value === 'string' || typeof value === 'number') {
                value =
                    typeof value === 'string' || typeof value === 'number'
                        ? String(value)
                        : '';
            }
            result.push({
                type: typeof value === 'string' ? PART_TYPE.literal : PART_TYPE.object,
                value: value,
            });
            continue;
        }
        // Recursively format plural and select parts' option — which can be a
        // nested pattern structure. The choosing of the option to use is
        // abstracted-by and delegated-to the part helper object.
        if (isDateElement(el)) {
            var style = typeof el.style === 'string'
                ? formats.date[el.style]
                : isDateTimeSkeleton(el.style)
                    ? el.style.parsedOptions
                    : undefined;
            result.push({
                type: PART_TYPE.literal,
                value: formatters
                    .getDateTimeFormat(locales, style)
                    .format(value),
            });
            continue;
        }
        if (isTimeElement(el)) {
            var style = typeof el.style === 'string'
                ? formats.time[el.style]
                : isDateTimeSkeleton(el.style)
                    ? el.style.parsedOptions
                    : formats.time.medium;
            result.push({
                type: PART_TYPE.literal,
                value: formatters
                    .getDateTimeFormat(locales, style)
                    .format(value),
            });
            continue;
        }
        if (isNumberElement(el)) {
            var style = typeof el.style === 'string'
                ? formats.number[el.style]
                : isNumberSkeleton(el.style)
                    ? el.style.parsedOptions
                    : undefined;
            if (style && style.scale) {
                value =
                    value *
                        (style.scale || 1);
            }
            result.push({
                type: PART_TYPE.literal,
                value: formatters
                    .getNumberFormat(locales, style)
                    .format(value),
            });
            continue;
        }
        if (isTagElement(el)) {
            var children = el.children, value_1 = el.value;
            var formatFn = values[value_1];
            if (!isFormatXMLElementFn(formatFn)) {
                throw new InvalidValueTypeError(value_1, 'function', originalMessage);
            }
            var parts = formatToParts(children, locales, formatters, formats, values, currentPluralValue);
            var chunks = formatFn(parts.map(function (p) { return p.value; }));
            if (!Array.isArray(chunks)) {
                chunks = [chunks];
            }
            result.push.apply(result, chunks.map(function (c) {
                return {
                    type: typeof c === 'string' ? PART_TYPE.literal : PART_TYPE.object,
                    value: c,
                };
            }));
        }
        if (isSelectElement(el)) {
            var opt = el.options[value] || el.options.other;
            if (!opt) {
                throw new InvalidValueError(el.value, value, Object.keys(el.options), originalMessage);
            }
            result.push.apply(result, formatToParts(opt.value, locales, formatters, formats, values));
            continue;
        }
        if (isPluralElement(el)) {
            var opt = el.options["=".concat(value)];
            if (!opt) {
                if (!Intl.PluralRules) {
                    throw new FormatError("Intl.PluralRules is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-pluralrules\"\n", ErrorCode.MISSING_INTL_API, originalMessage);
                }
                var rule = formatters
                    .getPluralRules(locales, { type: el.pluralType })
                    .select(value - (el.offset || 0));
                opt = el.options[rule] || el.options.other;
            }
            if (!opt) {
                throw new InvalidValueError(el.value, value, Object.keys(el.options), originalMessage);
            }
            result.push.apply(result, formatToParts(opt.value, locales, formatters, formats, values, value - (el.offset || 0)));
            continue;
        }
    }
    return mergeLiteral(result);
}

/*
Copyright (c) 2014, Yahoo! Inc. All rights reserved.
Copyrights licensed under the New BSD License.
See the accompanying LICENSE file for terms.
*/
// -- MessageFormat --------------------------------------------------------
function mergeConfig(c1, c2) {
    if (!c2) {
        return c1;
    }
    return __assign(__assign(__assign({}, (c1 || {})), (c2 || {})), Object.keys(c1).reduce(function (all, k) {
        all[k] = __assign(__assign({}, c1[k]), (c2[k] || {}));
        return all;
    }, {}));
}
function mergeConfigs(defaultConfig, configs) {
    if (!configs) {
        return defaultConfig;
    }
    return Object.keys(defaultConfig).reduce(function (all, k) {
        all[k] = mergeConfig(defaultConfig[k], configs[k]);
        return all;
    }, __assign({}, defaultConfig));
}
function createFastMemoizeCache$1(store) {
    return {
        create: function () {
            return {
                get: function (key) {
                    return store[key];
                },
                set: function (key, value) {
                    store[key] = value;
                },
            };
        },
    };
}
function createDefaultFormatters(cache) {
    if (cache === void 0) { cache = {
        number: {},
        dateTime: {},
        pluralRules: {},
    }; }
    return {
        getNumberFormat: memoize(function () {
            var _a;
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return new ((_a = Intl.NumberFormat).bind.apply(_a, __spreadArray([void 0], args, false)))();
        }, {
            cache: createFastMemoizeCache$1(cache.number),
            strategy: strategies.variadic,
        }),
        getDateTimeFormat: memoize(function () {
            var _a;
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return new ((_a = Intl.DateTimeFormat).bind.apply(_a, __spreadArray([void 0], args, false)))();
        }, {
            cache: createFastMemoizeCache$1(cache.dateTime),
            strategy: strategies.variadic,
        }),
        getPluralRules: memoize(function () {
            var _a;
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return new ((_a = Intl.PluralRules).bind.apply(_a, __spreadArray([void 0], args, false)))();
        }, {
            cache: createFastMemoizeCache$1(cache.pluralRules),
            strategy: strategies.variadic,
        }),
    };
}
var IntlMessageFormat = /** @class */ (function () {
    function IntlMessageFormat(message, locales, overrideFormats, opts) {
        if (locales === void 0) { locales = IntlMessageFormat.defaultLocale; }
        var _this = this;
        this.formatterCache = {
            number: {},
            dateTime: {},
            pluralRules: {},
        };
        this.format = function (values) {
            var parts = _this.formatToParts(values);
            // Hot path for straight simple msg translations
            if (parts.length === 1) {
                return parts[0].value;
            }
            var result = parts.reduce(function (all, part) {
                if (!all.length ||
                    part.type !== PART_TYPE.literal ||
                    typeof all[all.length - 1] !== 'string') {
                    all.push(part.value);
                }
                else {
                    all[all.length - 1] += part.value;
                }
                return all;
            }, []);
            if (result.length <= 1) {
                return result[0] || '';
            }
            return result;
        };
        this.formatToParts = function (values) {
            return formatToParts(_this.ast, _this.locales, _this.formatters, _this.formats, values, undefined, _this.message);
        };
        this.resolvedOptions = function () {
            var _a;
            return ({
                locale: ((_a = _this.resolvedLocale) === null || _a === void 0 ? void 0 : _a.toString()) ||
                    Intl.NumberFormat.supportedLocalesOf(_this.locales)[0],
            });
        };
        this.getAst = function () { return _this.ast; };
        // Defined first because it's used to build the format pattern.
        this.locales = locales;
        this.resolvedLocale = IntlMessageFormat.resolveLocale(locales);
        if (typeof message === 'string') {
            this.message = message;
            if (!IntlMessageFormat.__parse) {
                throw new TypeError('IntlMessageFormat.__parse must be set to process `message` of type `string`');
            }
            var _a = opts || {}; _a.formatters; var parseOpts = __rest(_a, ["formatters"]);
            // Parse string messages into an AST.
            this.ast = IntlMessageFormat.__parse(message, __assign(__assign({}, parseOpts), { locale: this.resolvedLocale }));
        }
        else {
            this.ast = message;
        }
        if (!Array.isArray(this.ast)) {
            throw new TypeError('A message must be provided as a String or AST.');
        }
        // Creates a new object with the specified `formats` merged with the default
        // formats.
        this.formats = mergeConfigs(IntlMessageFormat.formats, overrideFormats);
        this.formatters =
            (opts && opts.formatters) || createDefaultFormatters(this.formatterCache);
    }
    Object.defineProperty(IntlMessageFormat, "defaultLocale", {
        get: function () {
            if (!IntlMessageFormat.memoizedDefaultLocale) {
                IntlMessageFormat.memoizedDefaultLocale =
                    new Intl.NumberFormat().resolvedOptions().locale;
            }
            return IntlMessageFormat.memoizedDefaultLocale;
        },
        enumerable: false,
        configurable: true
    });
    IntlMessageFormat.memoizedDefaultLocale = null;
    IntlMessageFormat.resolveLocale = function (locales) {
        if (typeof Intl.Locale === 'undefined') {
            return;
        }
        var supportedLocales = Intl.NumberFormat.supportedLocalesOf(locales);
        if (supportedLocales.length > 0) {
            return new Intl.Locale(supportedLocales[0]);
        }
        return new Intl.Locale(typeof locales === 'string' ? locales : locales[0]);
    };
    IntlMessageFormat.__parse = parse;
    // Default format options used as the prototype of the `formats` provided to the
    // constructor. These are used when constructing the internal Intl.NumberFormat
    // and Intl.DateTimeFormat instances.
    IntlMessageFormat.formats = {
        number: {
            integer: {
                maximumFractionDigits: 0,
            },
            currency: {
                style: 'currency',
            },
            percent: {
                style: 'percent',
            },
        },
        date: {
            short: {
                month: 'numeric',
                day: 'numeric',
                year: '2-digit',
            },
            medium: {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            },
            long: {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            },
            full: {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            },
        },
        time: {
            short: {
                hour: 'numeric',
                minute: 'numeric',
            },
            medium: {
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
            },
            long: {
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
                timeZoneName: 'short',
            },
            full: {
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
                timeZoneName: 'short',
            },
        },
    };
    return IntlMessageFormat;
}());

var IntlErrorCode;
(function (IntlErrorCode) {
    IntlErrorCode["FORMAT_ERROR"] = "FORMAT_ERROR";
    IntlErrorCode["UNSUPPORTED_FORMATTER"] = "UNSUPPORTED_FORMATTER";
    IntlErrorCode["INVALID_CONFIG"] = "INVALID_CONFIG";
    IntlErrorCode["MISSING_DATA"] = "MISSING_DATA";
    IntlErrorCode["MISSING_TRANSLATION"] = "MISSING_TRANSLATION";
})(IntlErrorCode || (IntlErrorCode = {}));
var IntlError = /** @class */ (function (_super) {
    __extends(IntlError, _super);
    function IntlError(code, message, exception) {
        var _this = this;
        var err = exception
            ? exception instanceof Error
                ? exception
                : new Error(String(exception))
            : undefined;
        _this = _super.call(this, "[@formatjs/intl Error ".concat(code, "] ").concat(message, "\n").concat(err ? "\n".concat(err.message, "\n").concat(err.stack) : '')) || this;
        _this.code = code;
        // @ts-ignore just so we don't need to declare dep on @types/node
        if (typeof Error.captureStackTrace === 'function') {
            // @ts-ignore just so we don't need to declare dep on @types/node
            Error.captureStackTrace(_this, IntlError);
        }
        return _this;
    }
    return IntlError;
}(Error));
var UnsupportedFormatterError = /** @class */ (function (_super) {
    __extends(UnsupportedFormatterError, _super);
    function UnsupportedFormatterError(message, exception) {
        return _super.call(this, IntlErrorCode.UNSUPPORTED_FORMATTER, message, exception) || this;
    }
    return UnsupportedFormatterError;
}(IntlError));
var InvalidConfigError = /** @class */ (function (_super) {
    __extends(InvalidConfigError, _super);
    function InvalidConfigError(message, exception) {
        return _super.call(this, IntlErrorCode.INVALID_CONFIG, message, exception) || this;
    }
    return InvalidConfigError;
}(IntlError));
var MissingDataError = /** @class */ (function (_super) {
    __extends(MissingDataError, _super);
    function MissingDataError(message, exception) {
        return _super.call(this, IntlErrorCode.MISSING_DATA, message, exception) || this;
    }
    return MissingDataError;
}(IntlError));
var IntlFormatError = /** @class */ (function (_super) {
    __extends(IntlFormatError, _super);
    function IntlFormatError(message, locale, exception) {
        var _this = _super.call(this, IntlErrorCode.FORMAT_ERROR, "".concat(message, "\nLocale: ").concat(locale, "\n"), exception) || this;
        _this.locale = locale;
        return _this;
    }
    return IntlFormatError;
}(IntlError));
var MessageFormatError = /** @class */ (function (_super) {
    __extends(MessageFormatError, _super);
    function MessageFormatError(message, locale, descriptor, exception) {
        var _this = _super.call(this, "".concat(message, "\nMessageID: ").concat(descriptor === null || descriptor === void 0 ? void 0 : descriptor.id, "\nDefault Message: ").concat(descriptor === null || descriptor === void 0 ? void 0 : descriptor.defaultMessage, "\nDescription: ").concat(descriptor === null || descriptor === void 0 ? void 0 : descriptor.description, "\n"), locale, exception) || this;
        _this.descriptor = descriptor;
        _this.locale = locale;
        return _this;
    }
    return MessageFormatError;
}(IntlFormatError));
var MissingTranslationError = /** @class */ (function (_super) {
    __extends(MissingTranslationError, _super);
    function MissingTranslationError(descriptor, locale) {
        var _this = _super.call(this, IntlErrorCode.MISSING_TRANSLATION, "Missing message: \"".concat(descriptor.id, "\" for locale \"").concat(locale, "\", using ").concat(descriptor.defaultMessage
            ? "default message (".concat(typeof descriptor.defaultMessage === 'string'
                ? descriptor.defaultMessage
                : descriptor.defaultMessage
                    .map(function (e) { var _a; return (_a = e.value) !== null && _a !== void 0 ? _a : JSON.stringify(e); })
                    .join(), ")")
            : 'id', " as fallback.")) || this;
        _this.descriptor = descriptor;
        return _this;
    }
    return MissingTranslationError;
}(IntlError));

function invariant(condition, message, Err) {
    if (Err === void 0) { Err = Error; }
    if (!condition) {
        throw new Err(message);
    }
}
function filterProps(props, allowlist, defaults) {
    if (defaults === void 0) { defaults = {}; }
    return allowlist.reduce(function (filtered, name) {
        if (name in props) {
            filtered[name] = props[name];
        }
        else if (name in defaults) {
            filtered[name] = defaults[name];
        }
        return filtered;
    }, {});
}
var defaultErrorHandler = function (error) {
    // @ts-ignore just so we don't need to declare dep on @types/node
    if (process.env.NODE_ENV !== 'production') {
        console.error(error);
    }
};
var defaultWarnHandler = function (warning) {
    // @ts-ignore just so we don't need to declare dep on @types/node
    if (process.env.NODE_ENV !== 'production') {
        console.warn(warning);
    }
};
var DEFAULT_INTL_CONFIG = {
    formats: {},
    messages: {},
    timeZone: undefined,
    defaultLocale: 'en',
    defaultFormats: {},
    fallbackOnEmptyString: true,
    onError: defaultErrorHandler,
    onWarn: defaultWarnHandler,
};
function createIntlCache() {
    return {
        dateTime: {},
        number: {},
        message: {},
        relativeTime: {},
        pluralRules: {},
        list: {},
        displayNames: {},
    };
}
function createFastMemoizeCache(store) {
    return {
        create: function () {
            return {
                get: function (key) {
                    return store[key];
                },
                set: function (key, value) {
                    store[key] = value;
                },
            };
        },
    };
}
/**
 * Create intl formatters and populate cache
 * @param cache explicit cache to prevent leaking memory
 */
function createFormatters(cache) {
    if (cache === void 0) { cache = createIntlCache(); }
    var RelativeTimeFormat = Intl.RelativeTimeFormat;
    var ListFormat = Intl.ListFormat;
    var DisplayNames = Intl.DisplayNames;
    var getDateTimeFormat = memoize(function () {
        var _a;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return new ((_a = Intl.DateTimeFormat).bind.apply(_a, __spreadArray([void 0], args, false)))();
    }, {
        cache: createFastMemoizeCache(cache.dateTime),
        strategy: strategies.variadic,
    });
    var getNumberFormat = memoize(function () {
        var _a;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return new ((_a = Intl.NumberFormat).bind.apply(_a, __spreadArray([void 0], args, false)))();
    }, {
        cache: createFastMemoizeCache(cache.number),
        strategy: strategies.variadic,
    });
    var getPluralRules = memoize(function () {
        var _a;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return new ((_a = Intl.PluralRules).bind.apply(_a, __spreadArray([void 0], args, false)))();
    }, {
        cache: createFastMemoizeCache(cache.pluralRules),
        strategy: strategies.variadic,
    });
    return {
        getDateTimeFormat: getDateTimeFormat,
        getNumberFormat: getNumberFormat,
        getMessageFormat: memoize(function (message, locales, overrideFormats, opts) {
            return new IntlMessageFormat(message, locales, overrideFormats, __assign({ formatters: {
                    getNumberFormat: getNumberFormat,
                    getDateTimeFormat: getDateTimeFormat,
                    getPluralRules: getPluralRules,
                } }, (opts || {})));
        }, {
            cache: createFastMemoizeCache(cache.message),
            strategy: strategies.variadic,
        }),
        getRelativeTimeFormat: memoize(function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return new (RelativeTimeFormat.bind.apply(RelativeTimeFormat, __spreadArray([void 0], args, false)))();
        }, {
            cache: createFastMemoizeCache(cache.relativeTime),
            strategy: strategies.variadic,
        }),
        getPluralRules: getPluralRules,
        getListFormat: memoize(function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return new (ListFormat.bind.apply(ListFormat, __spreadArray([void 0], args, false)))();
        }, {
            cache: createFastMemoizeCache(cache.list),
            strategy: strategies.variadic,
        }),
        getDisplayNames: memoize(function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return new (DisplayNames.bind.apply(DisplayNames, __spreadArray([void 0], args, false)))();
        }, {
            cache: createFastMemoizeCache(cache.displayNames),
            strategy: strategies.variadic,
        }),
    };
}
function getNamedFormat(formats, type, name, onError) {
    var formatType = formats && formats[type];
    var format;
    if (formatType) {
        format = formatType[name];
    }
    if (format) {
        return format;
    }
    onError(new UnsupportedFormatterError("No ".concat(type, " format named: ").concat(name)));
}

function setTimeZoneInOptions(opts, timeZone) {
    return Object.keys(opts).reduce(function (all, k) {
        all[k] = __assign({ timeZone: timeZone }, opts[k]);
        return all;
    }, {});
}
function deepMergeOptions(opts1, opts2) {
    var keys = Object.keys(__assign(__assign({}, opts1), opts2));
    return keys.reduce(function (all, k) {
        all[k] = __assign(__assign({}, (opts1[k] || {})), (opts2[k] || {}));
        return all;
    }, {});
}
function deepMergeFormatsAndSetTimeZone(f1, timeZone) {
    if (!timeZone) {
        return f1;
    }
    var mfFormats = IntlMessageFormat.formats;
    return __assign(__assign(__assign({}, mfFormats), f1), { date: deepMergeOptions(setTimeZoneInOptions(mfFormats.date, timeZone), setTimeZoneInOptions(f1.date || {}, timeZone)), time: deepMergeOptions(setTimeZoneInOptions(mfFormats.time, timeZone), setTimeZoneInOptions(f1.time || {}, timeZone)) });
}
var formatMessage = function (_a, state, messageDescriptor, values, opts) {
    var locale = _a.locale, formats = _a.formats, messages = _a.messages, defaultLocale = _a.defaultLocale, defaultFormats = _a.defaultFormats, fallbackOnEmptyString = _a.fallbackOnEmptyString, onError = _a.onError, timeZone = _a.timeZone, defaultRichTextElements = _a.defaultRichTextElements;
    if (messageDescriptor === void 0) { messageDescriptor = { id: '' }; }
    var msgId = messageDescriptor.id, defaultMessage = messageDescriptor.defaultMessage;
    // `id` is a required field of a Message Descriptor.
    invariant(!!msgId, "[@formatjs/intl] An `id` must be provided to format a message. You can either:\n1. Configure your build toolchain with [babel-plugin-formatjs](https://formatjs.github.io/docs/tooling/babel-plugin)\nor [@formatjs/ts-transformer](https://formatjs.github.io/docs/tooling/ts-transformer) OR\n2. Configure your `eslint` config to include [eslint-plugin-formatjs](https://formatjs.github.io/docs/tooling/linter#enforce-id)\nto autofix this issue");
    var id = String(msgId);
    var message = 
    // In case messages is Object.create(null)
    // e.g import('foo.json') from webpack)
    // See https://github.com/formatjs/formatjs/issues/1914
    messages &&
        Object.prototype.hasOwnProperty.call(messages, id) &&
        messages[id];
    // IMPORTANT: Hot path if `message` is AST with a single literal node
    if (Array.isArray(message) &&
        message.length === 1 &&
        message[0].type === TYPE.literal) {
        return message[0].value;
    }
    // IMPORTANT: Hot path straight lookup for performance
    if (!values &&
        message &&
        typeof message === 'string' &&
        !defaultRichTextElements) {
        return message.replace(/'\{(.*?)\}'/gi, "{$1}");
    }
    values = __assign(__assign({}, defaultRichTextElements), (values || {}));
    formats = deepMergeFormatsAndSetTimeZone(formats, timeZone);
    defaultFormats = deepMergeFormatsAndSetTimeZone(defaultFormats, timeZone);
    if (!message) {
        if (fallbackOnEmptyString === false && message === '') {
            return message;
        }
        if (!defaultMessage ||
            (locale && locale.toLowerCase() !== defaultLocale.toLowerCase())) {
            // This prevents warnings from littering the console in development
            // when no `messages` are passed into the <IntlProvider> for the
            // default locale.
            onError(new MissingTranslationError(messageDescriptor, locale));
        }
        if (defaultMessage) {
            try {
                var formatter = state.getMessageFormat(defaultMessage, defaultLocale, defaultFormats, opts);
                return formatter.format(values);
            }
            catch (e) {
                onError(new MessageFormatError("Error formatting default message for: \"".concat(id, "\", rendering default message verbatim"), locale, messageDescriptor, e));
                return typeof defaultMessage === 'string' ? defaultMessage : id;
            }
        }
        return id;
    }
    // We have the translated message
    try {
        var formatter = state.getMessageFormat(message, locale, formats, __assign({ formatters: state }, (opts || {})));
        return formatter.format(values);
    }
    catch (e) {
        onError(new MessageFormatError("Error formatting message: \"".concat(id, "\", using ").concat(defaultMessage ? 'default message' : 'id', " as fallback."), locale, messageDescriptor, e));
    }
    if (defaultMessage) {
        try {
            var formatter = state.getMessageFormat(defaultMessage, defaultLocale, defaultFormats, opts);
            return formatter.format(values);
        }
        catch (e) {
            onError(new MessageFormatError("Error formatting the default message for: \"".concat(id, "\", rendering message verbatim"), locale, messageDescriptor, e));
        }
    }
    if (typeof message === 'string') {
        return message;
    }
    if (typeof defaultMessage === 'string') {
        return defaultMessage;
    }
    return id;
};

var DATE_TIME_FORMAT_OPTIONS = [
    'formatMatcher',
    'timeZone',
    'hour12',
    'weekday',
    'era',
    'year',
    'month',
    'day',
    'hour',
    'minute',
    'second',
    'timeZoneName',
    'hourCycle',
    'dateStyle',
    'timeStyle',
    'calendar',
    // 'dayPeriod',
    'numberingSystem',
    'fractionalSecondDigits',
];
function getFormatter$2(_a, type, getDateTimeFormat, options) {
    var locale = _a.locale, formats = _a.formats, onError = _a.onError, timeZone = _a.timeZone;
    if (options === void 0) { options = {}; }
    var format = options.format;
    var defaults = __assign(__assign({}, (timeZone && { timeZone: timeZone })), (format && getNamedFormat(formats, type, format, onError)));
    var filteredOptions = filterProps(options, DATE_TIME_FORMAT_OPTIONS, defaults);
    if (type === 'time' &&
        !filteredOptions.hour &&
        !filteredOptions.minute &&
        !filteredOptions.second &&
        !filteredOptions.timeStyle &&
        !filteredOptions.dateStyle) {
        // Add default formatting options if hour, minute, or second isn't defined.
        filteredOptions = __assign(__assign({}, filteredOptions), { hour: 'numeric', minute: 'numeric' });
    }
    return getDateTimeFormat(locale, filteredOptions);
}
function formatDate(config, getDateTimeFormat) {
    var _a = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        _a[_i - 2] = arguments[_i];
    }
    var value = _a[0], _b = _a[1], options = _b === void 0 ? {} : _b;
    var date = typeof value === 'string' ? new Date(value || 0) : value;
    try {
        return getFormatter$2(config, 'date', getDateTimeFormat, options).format(date);
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting date.', config.locale, e));
    }
    return String(date);
}
function formatTime(config, getDateTimeFormat) {
    var _a = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        _a[_i - 2] = arguments[_i];
    }
    var value = _a[0], _b = _a[1], options = _b === void 0 ? {} : _b;
    var date = typeof value === 'string' ? new Date(value || 0) : value;
    try {
        return getFormatter$2(config, 'time', getDateTimeFormat, options).format(date);
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting time.', config.locale, e));
    }
    return String(date);
}
function formatDateTimeRange(config, getDateTimeFormat) {
    var _a = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        _a[_i - 2] = arguments[_i];
    }
    var from = _a[0], to = _a[1], _b = _a[2], options = _b === void 0 ? {} : _b;
    var fromDate = typeof from === 'string' ? new Date(from || 0) : from;
    var toDate = typeof to === 'string' ? new Date(to || 0) : to;
    try {
        return getFormatter$2(config, 'dateTimeRange', getDateTimeFormat, options).formatRange(fromDate, toDate);
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting date time range.', config.locale, e));
    }
    return String(fromDate);
}
function formatDateToParts(config, getDateTimeFormat) {
    var _a = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        _a[_i - 2] = arguments[_i];
    }
    var value = _a[0], _b = _a[1], options = _b === void 0 ? {} : _b;
    var date = typeof value === 'string' ? new Date(value || 0) : value;
    try {
        return getFormatter$2(config, 'date', getDateTimeFormat, options).formatToParts(date); // TODO: remove this when https://github.com/microsoft/TypeScript/pull/50402 is merged
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting date.', config.locale, e));
    }
    return [];
}
function formatTimeToParts(config, getDateTimeFormat) {
    var _a = [];
    for (var _i = 2; _i < arguments.length; _i++) {
        _a[_i - 2] = arguments[_i];
    }
    var value = _a[0], _b = _a[1], options = _b === void 0 ? {} : _b;
    var date = typeof value === 'string' ? new Date(value || 0) : value;
    try {
        return getFormatter$2(config, 'time', getDateTimeFormat, options).formatToParts(date); // TODO: remove this when https://github.com/microsoft/TypeScript/pull/50402 is merged
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting time.', config.locale, e));
    }
    return [];
}

var DISPLAY_NAMES_OPTONS = [
    'style',
    'type',
    'fallback',
    'languageDisplay',
];
function formatDisplayName(_a, getDisplayNames, value, options) {
    var locale = _a.locale, onError = _a.onError;
    var DisplayNames = Intl.DisplayNames;
    if (!DisplayNames) {
        onError(new FormatError("Intl.DisplayNames is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-displaynames\"\n", ErrorCode.MISSING_INTL_API));
    }
    var filteredOptions = filterProps(options, DISPLAY_NAMES_OPTONS);
    try {
        return getDisplayNames(locale, filteredOptions).of(value);
    }
    catch (e) {
        onError(new IntlFormatError('Error formatting display name.', locale, e));
    }
}

var LIST_FORMAT_OPTIONS = [
    'type',
    'style',
];
var now = Date.now();
function generateToken(i) {
    return "".concat(now, "_").concat(i, "_").concat(now);
}
function formatList(opts, getListFormat, values, options) {
    if (options === void 0) { options = {}; }
    var results = formatListToParts(opts, getListFormat, values, options).reduce(function (all, el) {
        var val = el.value;
        if (typeof val !== 'string') {
            all.push(val);
        }
        else if (typeof all[all.length - 1] === 'string') {
            all[all.length - 1] += val;
        }
        else {
            all.push(val);
        }
        return all;
    }, []);
    return results.length === 1 ? results[0] : results.length === 0 ? '' : results;
}
function formatListToParts(_a, getListFormat, values, options) {
    var locale = _a.locale, onError = _a.onError;
    if (options === void 0) { options = {}; }
    var ListFormat = Intl.ListFormat;
    if (!ListFormat) {
        onError(new FormatError("Intl.ListFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-listformat\"\n", ErrorCode.MISSING_INTL_API));
    }
    var filteredOptions = filterProps(options, LIST_FORMAT_OPTIONS);
    try {
        var richValues_1 = {};
        var serializedValues = values.map(function (v, i) {
            if (typeof v === 'object') {
                var id = generateToken(i);
                richValues_1[id] = v;
                return id;
            }
            return String(v);
        });
        return getListFormat(locale, filteredOptions)
            .formatToParts(serializedValues)
            .map(function (part) {
            return (part.type === 'literal'
                ? part
                : __assign(__assign({}, part), { value: richValues_1[part.value] || part.value }));
        });
    }
    catch (e) {
        onError(new IntlFormatError('Error formatting list.', locale, e));
    }
    // @ts-ignore
    return values;
}

var PLURAL_FORMAT_OPTIONS = ['type'];
function formatPlural(_a, getPluralRules, value, options) {
    var locale = _a.locale, onError = _a.onError;
    if (options === void 0) { options = {}; }
    if (!Intl.PluralRules) {
        onError(new FormatError("Intl.PluralRules is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-pluralrules\"\n", ErrorCode.MISSING_INTL_API));
    }
    var filteredOptions = filterProps(options, PLURAL_FORMAT_OPTIONS);
    try {
        return getPluralRules(locale, filteredOptions).select(value);
    }
    catch (e) {
        onError(new IntlFormatError('Error formatting plural.', locale, e));
    }
    return 'other';
}

var RELATIVE_TIME_FORMAT_OPTIONS = ['numeric', 'style'];
function getFormatter$1(_a, getRelativeTimeFormat, options) {
    var locale = _a.locale, formats = _a.formats, onError = _a.onError;
    if (options === void 0) { options = {}; }
    var format = options.format;
    var defaults = (!!format && getNamedFormat(formats, 'relative', format, onError)) || {};
    var filteredOptions = filterProps(options, RELATIVE_TIME_FORMAT_OPTIONS, defaults);
    return getRelativeTimeFormat(locale, filteredOptions);
}
function formatRelativeTime(config, getRelativeTimeFormat, value, unit, options) {
    if (options === void 0) { options = {}; }
    if (!unit) {
        unit = 'second';
    }
    var RelativeTimeFormat = Intl.RelativeTimeFormat;
    if (!RelativeTimeFormat) {
        config.onError(new FormatError("Intl.RelativeTimeFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-relativetimeformat\"\n", ErrorCode.MISSING_INTL_API));
    }
    try {
        return getFormatter$1(config, getRelativeTimeFormat, options).format(value, unit);
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting relative time.', config.locale, e));
    }
    return String(value);
}

var NUMBER_FORMAT_OPTIONS = [
    'style',
    'currency',
    'unit',
    'unitDisplay',
    'useGrouping',
    'minimumIntegerDigits',
    'minimumFractionDigits',
    'maximumFractionDigits',
    'minimumSignificantDigits',
    'maximumSignificantDigits',
    // ES2020 NumberFormat
    'compactDisplay',
    'currencyDisplay',
    'currencySign',
    'notation',
    'signDisplay',
    'unit',
    'unitDisplay',
    'numberingSystem',
    // ES2023 NumberFormat
    'trailingZeroDisplay',
    'roundingPriority',
    'roundingIncrement',
    'roundingMode',
];
function getFormatter(_a, getNumberFormat, options) {
    var locale = _a.locale, formats = _a.formats, onError = _a.onError;
    if (options === void 0) { options = {}; }
    var format = options.format;
    var defaults = ((format &&
        getNamedFormat(formats, 'number', format, onError)) ||
        {});
    var filteredOptions = filterProps(options, NUMBER_FORMAT_OPTIONS, defaults);
    return getNumberFormat(locale, filteredOptions);
}
function formatNumber(config, getNumberFormat, value, options) {
    if (options === void 0) { options = {}; }
    try {
        return getFormatter(config, getNumberFormat, options).format(value);
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting number.', config.locale, e));
    }
    return String(value);
}
function formatNumberToParts(config, getNumberFormat, value, options) {
    if (options === void 0) { options = {}; }
    try {
        return getFormatter(config, getNumberFormat, options).formatToParts(value);
    }
    catch (e) {
        config.onError(new IntlFormatError('Error formatting number.', config.locale, e));
    }
    return [];
}

function messagesContainString(messages) {
    var firstMessage = messages ? messages[Object.keys(messages)[0]] : undefined;
    return typeof firstMessage === 'string';
}
function verifyConfigMessages(config) {
    if (config.onWarn &&
        config.defaultRichTextElements &&
        messagesContainString(config.messages || {})) {
        config.onWarn("[@formatjs/intl] \"defaultRichTextElements\" was specified but \"message\" was not pre-compiled. \nPlease consider using \"@formatjs/cli\" to pre-compile your messages for performance.\nFor more details see https://formatjs.github.io/docs/getting-started/message-distribution");
    }
}
/**
 * Create intl object
 * @param config intl config
 * @param cache cache for formatter instances to prevent memory leak
 */
function createIntl(config, cache) {
    var formatters = createFormatters(cache);
    var resolvedConfig = __assign(__assign({}, DEFAULT_INTL_CONFIG), config);
    var locale = resolvedConfig.locale, defaultLocale = resolvedConfig.defaultLocale, onError = resolvedConfig.onError;
    if (!locale) {
        if (onError) {
            onError(new InvalidConfigError("\"locale\" was not configured, using \"".concat(defaultLocale, "\" as fallback. See https://formatjs.github.io/docs/react-intl/api#intlshape for more details")));
        }
        // Since there's no registered locale data for `locale`, this will
        // fallback to the `defaultLocale` to make sure things can render.
        // The `messages` are overridden to the `defaultProps` empty object
        // to maintain referential equality across re-renders. It's assumed
        // each <FormattedMessage> contains a `defaultMessage` prop.
        resolvedConfig.locale = resolvedConfig.defaultLocale || 'en';
    }
    else if (!Intl.NumberFormat.supportedLocalesOf(locale).length && onError) {
        onError(new MissingDataError("Missing locale data for locale: \"".concat(locale, "\" in Intl.NumberFormat. Using default locale: \"").concat(defaultLocale, "\" as fallback. See https://formatjs.github.io/docs/react-intl#runtime-requirements for more details")));
    }
    else if (!Intl.DateTimeFormat.supportedLocalesOf(locale).length &&
        onError) {
        onError(new MissingDataError("Missing locale data for locale: \"".concat(locale, "\" in Intl.DateTimeFormat. Using default locale: \"").concat(defaultLocale, "\" as fallback. See https://formatjs.github.io/docs/react-intl#runtime-requirements for more details")));
    }
    verifyConfigMessages(resolvedConfig);
    return __assign(__assign({}, resolvedConfig), { formatters: formatters, formatNumber: formatNumber.bind(null, resolvedConfig, formatters.getNumberFormat), formatNumberToParts: formatNumberToParts.bind(null, resolvedConfig, formatters.getNumberFormat), formatRelativeTime: formatRelativeTime.bind(null, resolvedConfig, formatters.getRelativeTimeFormat), formatDate: formatDate.bind(null, resolvedConfig, formatters.getDateTimeFormat), formatDateToParts: formatDateToParts.bind(null, resolvedConfig, formatters.getDateTimeFormat), formatTime: formatTime.bind(null, resolvedConfig, formatters.getDateTimeFormat), formatDateTimeRange: formatDateTimeRange.bind(null, resolvedConfig, formatters.getDateTimeFormat), formatTimeToParts: formatTimeToParts.bind(null, resolvedConfig, formatters.getDateTimeFormat), formatPlural: formatPlural.bind(null, resolvedConfig, formatters.getPluralRules), formatMessage: formatMessage.bind(null, resolvedConfig, formatters), $t: formatMessage.bind(null, resolvedConfig, formatters), formatList: formatList.bind(null, resolvedConfig, formatters.getListFormat), formatListToParts: formatListToParts.bind(null, resolvedConfig, formatters.getListFormat), formatDisplayName: formatDisplayName.bind(null, resolvedConfig, formatters.getDisplayNames) });
}

const dictionary$5 = {
    description: "{title}, Sonified chart",
    "description-untitled": "Sonified chart",
    updated: "{title} updated",
    "updated-untitled": "Chart updated",
    missing: "missing",
    close: "Close",
    save: "Save",
    tooLow: "too low",
    tooHigh: "too high",
    nodeHasChildren: "has children",
    instructionArrows: "Use arrow keys to navigate.",
    instructionHierarchy: "Use Alt + Up and Down to navigate between levels.",
    instructionLive: "Press M to toggle monitor mode.",
    instructionHotkeys: "Press H for more hotkeys.",
    "summ-chart": "Sonified chart.",
    "summ-chart-live": "Sonified live chart.",
    "summ-chart-hier": "Sonified hierarchical chart.",
    "summ-chart-group": `Sonified chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    }.`,
    "summ-chart-title": `Sonified chart titled "{title}".`,
    "summ-chart-live-hier": "Sonified live hierarchical chart.",
    "summ-chart-live-group": `Sonified live chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    }.`,
    "summ-chart-live-title": `Sonified live chart titled "{title}".`,
    "summ-chart-hier-group": `Sonified hierarchical chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    }.`,
    "summ-chart-hier-title": `Sonified hierarchical chart titled "{title}".`,
    "summ-chart-group-title": `Sonified chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    } titled "{title}".`,
    "summ-chart-live-hier-group": `Sonified live hierarchical chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    }.`,
    "summ-chart-live-hier-title": `Sonified live hierarchical chart titled "{title}".`,
    "summ-chart-live-group-title": `Sonified live chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    } titled" {title}".`,
    "summ-chart-hier-group-title": `Sonified hierarchical chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    } titled "{title}".`,
    "summ-chart-live-hier-group-title": `Sonified live hierarchical chart with {groupCount, plural,
        =0 {no groups}
        one {1 group}
        other {{groupCount} groups}
    } titled "{title}".`,
    "axis-desc": `{letter} is "{label}" from {min} to {max}.`,
    "axis-desc-log": `{letter} is "{label}" from {min} to {max} logarithmic.`,
    "axis-desc-con": `{letter} is "{label}" from {min} to {max} continuously.`,
    "axis-desc-log-con": `{letter} is "{label}" from {min} to {max} logarithmic continuously.`,
    "kbr-speed": `Speed, {rate_in_ms}`,
    "kbr-not-live": "Not a live chart",
    monitoring: "Monitoring {switch, select, true {on} false {off} other {unknown}}",
    "group-unknown": `Group titled "{title}" uses an unsupported chart type.`,
    "chart-line": "Line chart.",
    "chart-bar": "Bar chart.",
    "chart-band": "Band chart.",
    "chart-pie": "Pie chart.",
    "chart-candlestick": "Candlestick chart.",
    "chart-histogram": "Histogram chart.",
    "chart-box": "Box chart.",
    "chart-matrix": "Matrix chart.",
    "chart-scatter": "Scatter chart.",
    "chart-treemap": "Treemap chart.",
    "chart-line-labeled": `Line chart showing "{label}".`,
    "chart-bar-labeled": `Bar chart showing "{label}".`,
    "chart-band-labeled": `Band chart showing "{label}".`,
    "chart-pie-labeled": `Pie chart showing "{label}".`,
    "chart-candlestick-labeled": `Candlestick chart showing "{label}".`,
    "chart-histogram-labeled": `Histogram showing "{label}".`,
    "chart-box-labeled": `Box plot showing "{label}".`,
    "chart-matrix-labeled": `Matrix plot showing "{label}".`,
    "chart-scatter-labeled": `Scatter plot showing "{label}".`,
    "chart-treemap-labeled": `Treemap chart showing "{label}".`,
    "stat-all": "All",
    "stat-open": "Open",
    "stat-high": "High",
    "stat-low": "Low",
    "stat-close": "Close",
    "stat-q1": "Q1",
    "stat-median": "Median",
    "stat-q3": "Q3",
    "stat-outlier": "Outlier",
    "point-xy": "{x}, {y}",
    "point-xohlc": "{x}, {open} - {high} - {low} - {close}",
    "point-outlier": "{x}, {y}, {index} of {count}",
    "point-xhl": "{x}, {high} - {low}",
    "point-xhl-outlier": `{x}, {high} - {low}, with {count, plural, 
        =0 {no outliers} 
        one {{count} outlier} 
        other {{count} outliers}
    }`,
    "info-open": "Open info dialog",
    "info-title": "Info",
    "info-notes": "Notes",
    "kbmg-title": "Keyboard Manager",
    "key-point-next": "Move to next point",
    "key-point-prev": "Move to previous point",
    "key-play-fwd": "Play to right edge of chart",
    "key-play-back": "Play to left edge of chart",
    "key-play-cancel": "Stop play",
    "key-group-prev": "Move to previous group",
    "key-stat-prev": "Move to previous statistic",
    "key-group-next": "Move to next group",
    "key-stat-next": "Move to next statistic",
    "key-group-first": "Move to first group",
    "key-group-last": "Move to last group",
    "key-hier-root": "Move to root",
    "key-play-fwd-group": "Play forwards through groups",
    "key-play-back-group": "Play backwards through groups",
    "key-point-first": "Move to left-most point",
    "key-point-last": "Move to right-most point",
    "key-replay": "Replay current point",
    "key-select": "Select item",
    "key-tenth-prev": "Move right by a tenth",
    "key-tenth-next": "Move left by a tenth",
    "key-level-min": "Move to level minimum value",
    "key-level-max": "Move to level maximum value",
    "key-group-min": "Move to group minimum value",
    "key-group-max": "Move to group maximum value",
    "key-chart-min": "Move to chart minimum value",
    "key-chart-max": "Move to chart maximum value",
    "key-level-decr": "Move down a level",
    "key-level-incr": "Move up a level",
    "key-speed-incr": "Increase playback speed",
    "key-speed-decr": "Decrease playback speed",
    "key-monitor-toggle": "Toggle monitor mode",
    "key-dialog-help": "Open help dialog",
    "key-dialog-options": "Open options dialog",
    "key-descr-ArrowRight": "Right arrow",
    "key-descr-ArrowLeft": "Left arrow",
    "key-descr-alt-Home": "Function + Left arrow",
    "key-descr-alt-End": "Function + Right arrow",
    "key-descr-Shift+End": "Shift + End",
    "key-descr-alt-Shift+End": "Shift + Function + Right arrow",
    "key-descr-Shift+Home": "Shift + Home",
    "key-descr-alt-Shift+Home": "Shift + Function + Left arrow",
    "key-descr-ctrl": "Control",
    "key-descr-spacebar": "Spacebar",
    "key-descr-Ctrl+ArrowRight": "Control + Right arrow",
    "key-descr-Ctrl+ArrowLeft": "Control + Left arrow",
    "key-descr-ArrowDown": "Down arrow",
    "key-descr-ArrowUp": "Up arrow",
    "key-descr-PageUp": "Page up",
    "key-descr-PageDown": "Page down",
    "key-descr-alt-PageUp": "Function + Up arrow",
    "key-descr-alt-PageDown": "Function + Down arrow",
    "key-descr-Alt+PageUp": "Alt + Page up",
    "key-descr-alt-Alt+PageUp": "Option + Function + Up arrow",
    "key-descr-Alt+PageDown": "Alt + Page down",
    "key-descr-alt-Alt+PageDown": "Option + Function + Down arrow",
    "key-descr-Shift+PageDown": "Shift + Page down",
    "key-descr-alt-Shift+PageDown": "Shift + Function + Down arrow",
    "key-descr-Shift+PageUp": "Shift + Page up",
    "key-descr-alt-Shift+PageUp": "Shift + Function + Up arrow",
    "key-descr-Ctrl+[": "Control + [",
    "key-descr-Ctrl+]": "Control + ]",
    "key-descr-Alt+ArrowDown": "Alt + Down arrow",
    "key-descr-Alt+ArrowUp": "Alt + Up arrow",
    "help-dialog-front-matter": "You can use the below keyboard shortcuts to navigate this chart more quickly. Please note, on some computers, the keys that you need to press may be called something else than what is listed below or may be emulated by a combination of keys. For example, on Apple keyboards without a physical home key, you can press the function key and the left arrow key at the same time to perform the same action. When possible, common alternate keyboard shortcuts will be provided in the below table.",
    "help-dialog-footer": "For information on making charts accessible and additional help, please visit ",
    "options-title": "Options",
    "options-frontmatter": "While navigating this chart, you may find some sounds too low or too high to hear. Alternatively, you may want to expand the range of the sounds available. Use these sliders to adjust the range of sound:",
    "options-hertz-lower": "Lower hertz",
    "options-hertz-upper": "Upper hertz",
    "options-speed-label": "Play speed (aka, press 'Q' and 'E')",
    "options-set-global": "Save my options for other charts on this page",
    "options-use-continuous": "Use continuous mode",
    "options-continuous-descr": "Continuous mode changes how values are played when you press Shift+Home and Shift+End",
    "options-point-labels": "Show point labels",
    "options-point-labels-before": `before values (eg: "California, 163,696 square miles, 39 million people" )`,
    "options-point-labels-after": `after values (eg: "163,696 square miles, 39 million people, California" )`
};

const dictionary$4 = {
    description: "{title}, Sonifizierte Grafik",
    "description-untitled": "Sonifizierte Grafik",
    updated: "{title} aktualisiert",
    "updated-untitled": "Aktualisierte Grafik",
    missing: "fehlt",
    close: "Schliessen",
    save: "Speichern",
    tooLow: "zu tief",
    tooHigh: "zu hoch",
    nodeHasChildren: "hat Kinder",
    instructionArrows: "Verwenden Sie die Pfeiltasten zum Navigieren.",
    instructionHierarchy: "Verwenden Sie Alt+Up und Down, um zwischen den Ebenen zu navigieren.",
    instructionLive: "Drücken Sie M, um den Anzeigemodus zu wechseln.",
    instructionHotkeys: "Drücken Sie H für weitere Tastaturbefehle.",
    "summ-chart": "Sonifizierte Grafik.",
    "summ-chart-live": "Sonifizierte Live-Grafik.",
    "summ-chart-hier": "Sonifizierte hierarchische Grafik.",
    "summ-chart-group": `Sonifizierte Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    }.`,
    "summ-chart-title": 'Sonifizierte Grafik mit dem Titel "{title}".',
    "summ-chart-live-hier": "Sonifizierte hierarchische Live-Grafik.",
    "summ-chart-live-group": `Sonifizierte Live-Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    }.`,
    "summ-chart-live-title": 'Sonifizierte Live-Grafik mit dem Titel "{title}".',
    "summ-chart-hier-group": `Sonifizierte hierarchische Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    }.`,
    "summ-chart-hier-title": 'Sonifizierte hierarchische Grafik mit dem Titel "{title}".',
    "summ-chart-group-title": `Sonifizierte Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    } mit dem Titel "{title}".`,
    "summ-chart-live-hier-group": `Sonifizierte hierarchische Live-Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    }.`,
    "summ-chart-live-hier-title": 'Sonifizierte hierarchische Live-Grafik mit dem Titel "{title}".',
    "summ-chart-live-group-title": `Sonifizierte Live-Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    } mit dem Titel "{title}".`,
    "summ-chart-hier-group-title": `Sonifizierte hierarchische Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    } mit dem Titel "{title}".`,
    "summ-chart-live-hier-group-title": `Sonifizierte hierarchische Live-Grafik mit {groupCount, plural,
        =0 {keinen Gruppen}
        one {1 Gruppe}
        other {{groupCount} Gruppen}
    } mit dem Titel "{title}".`,
    "axis-desc": '{letter} ist "{label}" von {min} bis {max}.',
    "axis-desc-log": '{letter} ist "{label}" von {min} bis {max} logarithmisch.',
    "axis-desc-con": '{letter} ist "{label}" von {min} bis {max} kontinuierlich.',
    "axis-desc-log-con": '{letter} ist "{label}" von {min} bis {max} kontinuierlich logarithmisch.',
    "kbr-speed": "Geschwindigkeit, {rate_in_ms},",
    "kbr-not-live": "Keine Live-Grafik",
    monitoring: "Monitoring {switch, select, true {eingeschaltet} false {ausgeschaltet} other {unbekannt}}",
    "group-unknown": 'Die Gruppe mit dem Titel "{Titel}" verwendet einen nicht unterstützten Diagrammtyp.',
    "chart-line": "Liniendiagramm",
    "chart-bar": "Balkendiagramm",
    "chart-band": "Banddiagramm",
    "chart-pie": "Kreisdiagramm",
    "chart-candlestick": "Kerzendiagramm",
    "chart-histogram": "Histogramm",
    "chart-box": "Kastendiagramm",
    "chart-matrix": "Matrixdiagramm",
    "chart-scatter": "Streudiagramm",
    "chart-treemap": "Kacheldiagramm",
    "chart-line-labeled": 'Liniendiagramm zeigt "{label}".',
    "chart-bar-labeled": 'Balkendiagramm zeigt "{label}".',
    "chart-band-labeled": 'Banddiagramm zeigt "{label}".',
    "chart-pie-labeled": 'Kreisdiagramm zeigt "{label}".',
    "chart-candlestick-labeled": 'Kerzendiagramm zeigt "{label}".',
    "chart-histogram-labeled": 'Histogramm zeigt "{label}".',
    "chart-box-labeled": 'Kastendiagramm zeigt "{label}".',
    "chart-matrix-labeled": 'Matrixdiagramm zeigt "{label}".',
    "chart-scatter-labeled": 'Streudiagramm zeigt "{label}".',
    "chart-treemap-labeled": 'Kacheldiagramm zeigt "{label}".',
    "stat-all": "Alles",
    "stat-open": "Öffnen",
    "stat-high": "Hoch",
    "stat-low": "Tief",
    "stat-close": "Schliessen",
    "stat-q1": "Q1",
    "stat-median": "Median",
    "stat-q3": "Q3",
    "stat-outlier": "Ausreisser",
    "point-xy": "{x}, {y}",
    "point-xohlc": "{x}, {open} - {high} - {low} - {close}",
    "point-outlier": "{x}, {y}, {index} von {count}",
    "point-xhl": "{x}, {high} - {low}",
    "point-xhl-outlier": `{x}, {high} - {low}, mit {count, plural, 
        =0 {keinem Ausreisser} 
        one {{count} Ausreisser} 
        other {{count} Ausreissern}
    }`,
    "info-open": "Info öffnen",
    "info-title": "Info",
    "info-notes": "Kommentare",
    "kbmg-title": "Tastatur-Manager",
    "key-point-next": "Zum nächsten Punkt wechseln",
    "key-point-prev": "Zum vorangehenden Punkt wechseln",
    "key-play-fwd": "Nach rechts wiedergeben",
    "key-play-back": "Nach links wiedergeben",
    "key-play-cancel": "Wiedergabe abbrechen",
    "key-group-prev": "Zur vorangehenden Gruppe wechseln ",
    "key-stat-prev": "Zur vorangehenden Statistik wechseln",
    "key-group-next": "Zur nächsten Gruppe wechseln",
    "key-stat-next": "Zur nächsten Statistik wechseln",
    "key-group-first": "Zur ersten Gruppe wechseln",
    "key-group-last": "Zur letzten Gruppe wechseln",
    "key-hier-root": "Zum Anfangselement zurückkehren",
    "key-play-fwd-group": "Gruppen vorwärts wiedergeben",
    "key-play-back-group": "Gruppen rückwärts wiedergeben",
    "key-point-first": "Zum ersten Punkt wechseln",
    "key-point-last": "Zum letzten Punkt wechseln",
    "key-replay": "Erneut wiedergeben",
    "key-select": "Element auswählen",
    "key-tenth-prev": "Um einen Zehntel zurückgehen",
    "key-tenth-next": "Um einen Zehntel vorwärts gehen",
    "key-level-min": "Zum tiefsten Wert der Ebene wechseln",
    "key-level-max": "Zum höchsten Wert der Ebene wechseln",
    "key-group-min": "Zum tiefsten Wert der Gruppe wechseln",
    "key-group-max": "Zum höchsten Wert der Gruppe wechseln",
    "key-chart-min": "Zum tiefsten Wert der Grafik wechseln ",
    "key-chart-max": "Zum höchsten Wert der Grafik wechseln ",
    "key-level-decr": "Eine Ebene nach unten gehen",
    "key-level-incr": "Eine Ebene nach oben gehen",
    "key-speed-incr": "Schneller",
    "key-speed-decr": "Langsamer",
    "key-monitor-toggle": "Anzeigemodus wechseln",
    "key-dialog-help": "Hilfe öffnen",
    "key-dialog-options": "Optionen öffnen",
    "options-title": "Optionen",
    "options-frontmatter": "Beim Navigieren in dieser Grafik kann es vorkommen, dass Sie einige Töne zu leise oder zu laut hören. Alternativ können Sie den Klangbereich mit diesen Schiebereglern erweitern:",
    "options-hertz-lower": "Tiefen",
    "options-hertz-upper": "Höhen",
    "options-speed-label": "Wiedergabegeschwindigkeit («Q» und «E» drücken)",
    "options-set-global": "Meine Optionen für andere Grafiken auf dieser Seite speichern",
    "options-use-continuous": "Dauermodus verwenden",
    "options-continuous-descr": "Im Dauermodus ändert sich die Wiedergabe der Werte, wenn Sie Umschalt+Home und Umschalt+End drücken.",
    "options-point-labels": "Punkt-Labels anzeigen:",
    "options-point-labels-before": "vor den Werten (z. B. «Kalifornien, 423’970 km², 39 Mio. Einwohner»)",
    "options-point-labels-after": "nach den Werten (z. B. «423’970 km², 39 Mio. Einwohner, Kalifornien»)"
};

const dictionary$3 = {
    description: "{title}, Gráfico Sonificado",
    "description-title": "Gráfico Sonificado",
    updated: "{title} Actualizado",
    "updated-untitled": "Gráfico Actualizado",
    missing: "Falta",
    close: "Cerrar",
    save: "Guardar",
    tooLow: "Muy bajo",
    tooHigh: "Muy alto",
    nodeHasChildren: "tiene hijos",
    instructionArrows: "Use las flechas para navegar.",
    instructionHierarchy: "Use Alt + Arriba y Abajo para navegar entre niveles.",
    instructionLive: "Presione M para cambiar modo de pantalla.",
    instructionHotkeys: "Presione H para más atajos.",
    "summ-chart": "Gráfico Sonificado.",
    "summ-chart-live": "Gráfico Sonificado en vivo.",
    "summ-chart-hier": "Gráfico Jerárquico Sonificado.",
    "summ-chart-group": `Gráfico Sonificado {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    }.`,
    "summ-chart-title": `Gráfico Sonificado llamado "{title}".`,
    "summ-chart-live-hier": "Gráfico Jerárquico Sonificado en vivo.",
    "summ-chart-live-group": `Gráfico Sonificado en vivo {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    }.`,
    "summ-chart-live-title": `Gráfico Sonificado en vivo llamado "{title}".`,
    "summ-chart-hier-group": `Gráfico Jerárquico Sonificado {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    }.`,
    "summ-chart-hier-title": `Gráfico Jerárquico Sonificado llamado "{title}".`,
    "summ-chart-group-title": `Gráfico Sonificado {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    } llamado "{title}".`,
    "summ-chart-live-hier-group": `Gráfico Jerárquico Sonificado en vivo {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    }.`,
    "summ-chart-live-hier-title": `Gráfico Jerárquico Sonificado en vivo llamado "{title}".`,
    "summ-chart-live-group-title": `Gráfico Sonificado en vivo {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    } llamado" {title}".`,
    "summ-chart-hier-group-title": `Gráfico Jerárquico Sonificado {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    } llamado "{title}".`,
    "summ-chart-live-hier-group-title": `Gráfico Jerárquico Sonificado en vivo {groupCount, plural,
        =0 {sin grupos}
        one {con 1 grupo}
        other {con {groupCount} grupos}
    } llamado "{title}".`,
    "axis-desc": `{letter} es "{label}" de {min} a {max}.`,
    "axis-desc-log": `{letter} es "{label}" de {min} a {max} logarítmico.`,
    "axis-desc-con": `{letter} es "{label}" de {min} a {max} continuo.`,
    "axis-desc-log-con": `{letter} is "{label}" from {min} to {max} logarítmico continuo.`,
    "kbr-speed": `Velocidad, {rate_in_ms}`,
    "kbr-not-live": "No es un gráfico en vivo",
    monitoring: "Reproducción {switch, select, true {encendida} false {apagada} other {desconocida}}",
    "group-unknown": `Grupo llamado "{title}" usa un tipo de gráfico no compatible.`,
    "chart-line": "Gráfico de líneas.",
    "chart-bar": "Gráfico de barras.",
    "chart-band": "Gráfico de bandas.",
    "chart-pie": "Gráfico de torta.",
    "chart-candlestick": "Gráfico de velas.",
    "chart-histogram": "Gráfico Histograma.",
    "chart-box": "Gráfico de cajas y bigotes.",
    "chart-matrix": "Gráfico Matriz.",
    "chart-scatter": "Gráfico de dispersión.",
    "chart-treemap": "Gráfico de árbol.",
    "chart-line-labeled": `Gráfico de líneas muestra "{label}".`,
    "chart-bar-labeled": `Gráfico de barras muestra "{label}".`,
    "chart-band-labeled": `Gráfico de bandas muestra "{label}".`,
    "chart-pie-labeled": `Gráfico de torta muestra "{label}".`,
    "chart-candlestick-labeled": `Gráfico de velas muestra "{label}".`,
    "chart-histogram-labeled": `Histograma muestra "{label}".`,
    "chart-box-labeled": `Gráfico de cajas y bigotes muestra "{label}".`,
    "chart-matrix-labeled": `Gráfico matriz muestra "{label}".`,
    "chart-scatter-labeled": `Gráfico de dispersión muestra "{label}".`,
    "chart-treemap-labeled": `Gráfico de árbol muestra "{label}".`,
    "stat-all": "Todo",
    "stat-open": "Abrir",
    "stat-high": "Alto",
    "stat-low": "Bajo",
    "stat-close": "Cerrar",
    "stat-q1": "Q1",
    "stat-median": "Mediana",
    "stat-q3": "Q3",
    "stat-outlier": "Valor Atípico",
    "point-xy": "{x}, {y}",
    "point-xohlc": "{x}, {open} - {high} - {low} - {close}",
    "point-outlier": "{x}, {y}, {index} de {count}",
    "point-xhl": "{x}, {high} - {low}",
    "point-xhl-outlier": `{x}, {high} - {low}, con {count, plural, 
        =0 {Sin valores atípicos} 
        one {{count} valor atípico} 
        other {{count} valores atípicos}
    }`,
    "info-open": "Abrir info",
    "info-title": "Info",
    "info-notes": "Notas",
    "kbmg-title": "Administrador de teclado",
    "key-point-next": "Ir al punto siguiente",
    "key-point-prev": "Ir al punto anterior",
    "key-play-fwd": "Reproducir a la derecha",
    "key-play-back": "Reproducir a la izquierda",
    "key-play-cancel": "Cancelar reproducción",
    "key-group-prev": "Ir al grupo anterior",
    "key-stat-prev": "Navegar a estadística anterior",
    "key-group-next": "Ir al grupo siguiente",
    "key-stat-next": "Navegar a la siguiente estadística",
    "key-group-first": "Ir al primer grupo",
    "key-group-last": "Ir al último grupo",
    "key-hier-root": "Ir a la raíz",
    "key-play-fwd-group": "Reproducir hacia adelante por los grupos",
    "key-play-back-group": "Reproducir hacia atrás por los grupos",
    "key-point-first": "Ir al primer punto",
    "key-point-last": "Ir al último punto",
    "key-replay": "Reproducir de nuevo",
    "key-select": "Seleccionar ítem",
    "key-tenth-prev": "Retroceder una décima",
    "key-tenth-next": "Adelantar una décima",
    "key-level-min": "Ir al menor valor del nivel",
    "key-level-max": "Ir al mayor valor del nivel",
    "key-group-min": "Ir al menor valor del grupo",
    "key-group-max": "Ir al mayor valor del grupo",
    "key-chart-min": "Ir al menor valor del gráfico",
    "key-chart-max": "Ir al mayor valor del gráfico",
    "key-level-decr": "Bajar un nivel",
    "key-level-incr": "Subir un nivel",
    "key-speed-incr": "Acelerar",
    "key-speed-decr": "Ralentizar",
    "key-monitor-toggle": "Cambiar modo de pantalla",
    "key-dialog-help": "Abrir diálogo de ayuda",
    "key-dialog-options": "Abrir diálogo de opciones",
    "options-title": "Opciones",
    "options-frontmatter": "Al navegar este gráfico algunos sonidos pueden reusltar muy altos o muy bajos para que los escuche. Adicionalmente, si desea expandir el rango de sonidos disponibles, deslice los controles para ajustar el rango de sonido:",
    "options-hertz-lower": "Hertz más bajo",
    "options-hertz-upper": "Hertz más alto",
    "options-speed-label": "Velocidad de reproducción (presione 'Q' y 'E')",
    "options-set-global": "Guardar mis opciones para otros gráficos en esta página",
    "options-use-continuous": "Usar modo continuo",
    "options-continuous-descr": "El modo continuo cambia cómo se reproducen los valores al presionar Shift+Home y Shift+End",
    "options-point-labels": "Mostrar etiquetas del punto",
    "options-point-labels-before": `valores anteriores (ejemplo: "California, 163,1802 kilómetros cuadrados, 39 millones de personas" )`,
    "options-point-labels-after": `valores siguientes (ejemplo: "163,1802 kilómetros cuadrados, 39 millones de personas, California" )`
};

const dictionary$2 = {
    description: "{title}, graphique sonifié",
    "description-untitled": "Graphique sonifié",
    updated: "{title} mis à jour",
    "updated-untitled": "Graphique mis à jour",
    missing: "manquant",
    close: "Fermer",
    save: "Enregistrer",
    tooLow: "trop grave",
    tooHigh: "trop aigu",
    nodeHasChildren: "a des enfants",
    instructionArrows: "Utilisez les flèches pour naviguer.",
    instructionHierarchy: "Utilisez Alt + Up et Down pour naviguer d’un niveau à l’autre.",
    instructionLive: "Pressez M pour changer de mode d’affichage.",
    instructionHotkeys: "Pressez H pour afficher d’autres touches de raccourci.",
    "summ-chart": "Graphique sonifié.",
    "summ-chart-live": "Graphique sonifié en direct.",
    "summ-chart-hier": "Graphique hiérarchique sonifié.",
    "summ-chart-group": `Graphique sonifié avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    }.`,
    "summ-chart-title": 'Graphique sonifié intitulé "{title}".',
    "summ-chart-live-hier": "Graphique hiérarchique sonifié en direct.",
    "summ-chart-live-group": `Graphique sonifié en direct avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    }.`,
    "summ-chart-live-title": 'Graphique sonifié en direct intitulé "{title}".',
    "summ-chart-hier-group": `Graphique hiérarchique sonifié avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    }.`,
    "summ-chart-hier-title": 'Graphique hiérarchique sonifié intitulé "{title}".',
    "summ-chart-group-title": `Graphique sonifié avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    } intitulé "{title}".`,
    "summ-chart-live-hier-group": `Graphique hiérarchique sonifié en direct avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    }.`,
    "summ-chart-live-hier-title": 'Graphique hiérarchique sonifié en direct intitulé "{title}".',
    "summ-chart-live-group-title": `Graphique sonifié en direct avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    } intitulé "{title}".`,
    "summ-chart-hier-group-title": `Graphique hiérarchique sonifié avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    } intitulé "{title}".`,
    "summ-chart-live-hier-group-title": `Graphique hiérarchique sonifié en direct avec {groupCount, plural,
        =0 {aucun groupe}
        one {un groupe}
        other {{groupCount} groupes}
    } intitulé "{title}".`,
    "axis-desc": '{letter} est "{label}" de {min} à {max}.',
    "axis-desc-log": '{letter} est "{label}" de {min} à {max} logarithmique.',
    "axis-desc-con": '{letter} est "{label}" de {min} à {max} en continu.',
    "axis-desc-log-con": '{letter} est "{label}" de {min} à {max} logarithmique en continu.',
    "kbr-speed": "Vitesse, {rate_in_ms}",
    "kbr-not-live": "Pas un graphique en direct",
    monitoring: "Monitoring {switch, select, true {activé} false {désactivé} other {inconnu}}",
    "group-unknown": 'Le groupe intitulé "{title}" utilise un type de graphique incompatible.',
    "chart-line": "Graphique linéaire.",
    "chart-bar": "Graphique à barres.",
    "chart-band": "Graphique à bandes.",
    "chart-pie": "Camembert.",
    "chart-candlestick": "Graphique en chandeliers.",
    "chart-histogram": "Histogramme.",
    "chart-box": "Graphique en boîtes.",
    "chart-matrix": "Graphique matriciel.",
    "chart-scatter": "Nuage de points.",
    "chart-treemap": "Graphique treemap.",
    "chart-line-labeled": 'Graphique linéaire montrant "{label}".',
    "chart-bar-labeled": 'Graphique à barres montrant "{label}".',
    "chart-band-labeled": 'Graphique à bandes montrant "{label}".',
    "chart-pie-labeled": 'Camembert montrant "{label}".',
    "chart-candlestick-labeled": 'Graphique en chandeliers montrant "{label}".',
    "chart-histogram-labeled": 'Histogramme montrant "{label}".',
    "chart-box-labeled": 'Graphique en boîtes montrant "{label}".',
    "chart-matrix-labeled": 'Graphique matriciel montrant "{label}".',
    "chart-scatter-labeled": 'Nuage de points montrant "{label}".',
    "chart-treemap-labeled": 'Graphique treemap montrant "{label}".',
    "stat-all": "Tout",
    "stat-open": "Ouvrir",
    "stat-high": "Aigu",
    "stat-low": "Grave",
    "stat-close": "Fermer",
    "stat-q1": "Q1",
    "stat-median": "Médiane",
    "stat-q3": "Q3",
    "stat-outlier": "Valeur aberrante",
    "point-xy": "{x}, {y}",
    "point-xohlc": "{x}, {open} - {high} - {low} - {close}",
    "point-outlier": "{x}, {y}, {index} de {count}",
    "point-xhl": "{x}, {high} - {low}",
    "point-xhl-outlier": `{x}, {high} - {low}, avec {count, plural, 
        =0 {aucune valeur aberrante} 
        one {{count} valeur aberrante} 
        other {{count} valeurs aberrantes}
    }`,
    "info-open": "Ouvrir info",
    "info-title": "Info",
    "info-notes": "Commentaires",
    "kbmg-title": "Gestionnaire de clavier",
    "key-point-next": "Aller au point suivant",
    "key-point-prev": "Aller au point précédent",
    "key-play-fwd": "Lire vers la droite",
    "key-play-back": "Lire vers la gauche",
    "key-play-cancel": "Annuler lecture",
    "key-group-prev": "Aller au groupe précédent",
    "key-stat-prev": "Aller à la statistique précédente",
    "key-group-next": "Aller au groupe suivant",
    "key-stat-next": "Aller à la statistique suivante",
    "key-group-first": "Aller au premier groupe",
    "key-group-last": "Aller au dernier groupe",
    "key-hier-root": "Aller à la racine",
    "key-play-fwd-group": "Lire vers l’avant à travers les groupes",
    "key-play-back-group": "Lire vers l’arrière à travers les groupes",
    "key-point-first": "Aller au premier point",
    "key-point-last": "Aller au dernier point",
    "key-replay": "Lire à nouveau",
    "key-select": "Sélectionner élément",
    "key-tenth-prev": "Reculer d’un dixième",
    "key-tenth-next": "Avancer d’un dixième",
    "key-level-min": "Aller à la valeur minimale du niveau",
    "key-level-max": "Aller à la valeur maximale du niveau",
    "key-group-min": "Aller à la valeur minimale du groupe",
    "key-group-max": "Aller à la valeur maximale du groupe",
    "key-chart-min": "Aller à la valeur minimale du graphique",
    "key-chart-max": "Aller à la valeur maximale du graphique",
    "key-level-decr": "Descendre d’un niveau",
    "key-level-incr": "Monter d’un niveau",
    "key-speed-incr": "Accélérer",
    "key-speed-decr": "Ralentir",
    "key-monitor-toggle": "Changer de mode d’affichage",
    "key-dialog-help": "Ouvrir aide",
    "key-dialog-options": "Ouvrir options",
    "options-title": "Options",
    "options-frontmatter": "Lorsque vous naviguez à travers ce graphique, il se peut que certains sons soient trop graves ou trop aigus pour être entendus. Vous avez également la possibilité d’étendre la gamme des sons disponibles en utilisant les curseurs suivants:",
    "options-hertz-lower": "Hertz plus grave",
    "options-hertz-upper": "Hertz plus aigu",
    "options-speed-label": "Vitesse de lecture (presser ’Q’ et ’E’)",
    "options-set-global": "Sauvegarder mes options pour d’autres graphiques sur cette page",
    "options-use-continuous": "Utiliser le mode continu",
    "options-continuous-descr": "Le mode continu modifie la façon dont les valeurs sont lues lorsque vous appuyez sur Majuscule+Home et Majuscule+End.",
    "options-point-labels": "Montrer les étiquettes du point",
    "options-point-labels-before": 'avant valeurs (par exemple "Californie, 423 970 kilomètres carrés, 39 millions d’habitants" )',
    "options-point-labels-after": 'après valeurs (par exemple "423 970 kilomètres carrés, 39 millions d’habitants, Californie" )'
};

const dictionary$1 = {
    description: "{title}, grafico sonificato",
    "description-untitled": "Grafico sonificato",
    updated: "{title} aggiornato",
    "updated-untitled": "Grafico aggiornato",
    missing: "mancante",
    close: "Chiudi",
    save: "Salva",
    tooLow: "troppo grave",
    tooHigh: "troppo acuto",
    nodeHasChildren: "ha figli",
    instructionArrows: "Usa le frecce per navigare.",
    instructionHierarchy: "Premi Alt + freccia su e freccia giù per passare da un livello all’altro.",
    instructionLive: "Premi M per cambiare modalità di visualizzazione.",
    instructionHotkeys: "Premi H per mostrare altre scorciatoie da tastiera.",
    "summ-chart": "Grafico sonificato.",
    "summ-chart-live": "Grafico sonificato in tempo reale.",
    "summ-chart-hier": "Grafico gerarchico sonificato.",
    "summ-chart-group": `Grafico sonificato con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    }.`,
    "summ-chart-title": 'Grafico sonificato intitolato "{title}".',
    "summ-chart-live-hier": "Grafico gerarchico sonificato in tempo reale.",
    "summ-chart-live-group": `Grafico sonificato in tempo reale con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    }.`,
    "summ-chart-live-title": 'Grafico sonificato in tempo reale intitolato "{title}".',
    "summ-chart-hier-group": `Grafico gerarchico sonificato con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    }.`,
    "summ-chart-hier-title": 'Grafico gerarchico sonificato intitolato "{title}".',
    "summ-chart-group-title": `Grafico sonificato con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    } intitolato "{title}".`,
    "summ-chart-live-hier-group": `Grafico gerarchico sonificato in tempo reale con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    }.`,
    "summ-chart-live-hier-title": 'Grafico gerarchico sonificato in tempo reale intitolato "{title}".',
    "summ-chart-live-group-title": `Grafico sonificato in tempo reale con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    } intitolato "{title}".`,
    "summ-chart-hier-group-title": `Grafico gerarchico sonificato con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    } intitolato "{title}".`,
    "summ-chart-live-hier-group-title": `Grafico gerarchico sonificato in tempo reale con {groupCount, plural,
        =0 {nessun gruppo}
        one {un gruppo}
        other {{groupCount} gruppi}
    } intitolato "{title}".`,
    "axis-desc": '{letter} è "{label}" da {min} a {max}.',
    "axis-desc-log": '{letter} è "{label}" da {min} a {max} logaritmico.',
    "axis-desc-con": '{letter} è "{label}" da {min} a {max} in maniera continua.',
    "axis-desc-log-con": '{letter} è "{label}" da {min} a {max} logaritmico in maniera continua.',
    "kbr-speed": "Velocità, {rate_in_ms}",
    "kbr-not-live": "Non è un grafico in tempo reale",
    monitoring: "Monitoraggio {switch, select, true {attivato} false {disattivato} other {sconosciuto}}",
    "group-unknown": 'Il gruppo intitolato "{title}" usa un tipo di grafico non supportato.',
    "chart-line": "Grafico a linee.",
    "chart-bar": "Ortogramma.",
    "chart-band": "Grafico a barre.",
    "chart-pie": "Diagramma a torta.",
    "chart-candlestick": "Candlestick.",
    "chart-histogram": "Istogramma.",
    "chart-box": "Diagramma a scatola e baffi.\n​",
    "chart-matrix": "Grafico a matrice.",
    "chart-scatter": "Grafico a dispersione.",
    "chart-treemap": "Treemap.",
    "chart-line-labeled": 'Grafico a linee che mostra "{label}".',
    "chart-bar-labeled": 'Ortogramma che mostra "{label}".',
    "chart-band-labeled": 'Grafico a barre che mostra "{label}".',
    "chart-pie-labeled": 'Diagramma a torta che mostra "{label}".',
    "chart-candlestick-labeled": 'Candlestick che mostra "{label}".',
    "chart-histogram-labeled": 'Istogramma che mostra "{label}".',
    "chart-box-labeled": 'Diagramma a scatola e baffi che mostra "{label}".',
    "chart-matrix-labeled": 'Grafico a matrice che mostra "{label}".',
    "chart-scatter-labeled": 'Grafico a dispersione che mostra "{label}".',
    "chart-treemap-labeled": 'Treemap che mostra "{label}".',
    "stat-all": "Tutto",
    "stat-open": "Apri",
    "stat-high": "Acuto",
    "stat-low": "Grave",
    "stat-close": "Chiudi",
    "stat-q1": "Q1",
    "stat-median": "Mediana",
    "stat-q3": "Q3",
    "stat-outlier": "Outlier",
    "point-xy": "{x}, {y}",
    "point-xohlc": "{x}, {open} - {high} - {low} - {close}",
    "point-outlier": "{x}, {y}, {index} di {count}",
    "point-xhl": "{x}, {high} - {low}",
    "point-xhl-outlier": `{x}, {high} - {low}, con {count, plural, 
        =0 {nessun outlier} 
        one {{count} outlier} 
        other {{count} outlier}
    }`,
    "info-open": "Apri info",
    "info-title": "Info",
    "info-notes": "Commenti",
    "kbmg-title": "Gestione tastiera",
    "key-point-next": "Vai al punto successivo",
    "key-point-prev": "Vai al punto precedente",
    "key-play-fwd": "Riproduci verso destra",
    "key-play-back": "Riproduci verso sinistra",
    "key-play-cancel": "Interrompi riproduzione",
    "key-group-prev": "Vai al gruppo precedente",
    "key-stat-prev": "Vai a statistica precedente",
    "key-group-next": "Vai al gruppo successivo",
    "key-stat-next": "Vai alla prossima statistica",
    "key-group-first": "Vai al primo gruppo",
    "key-group-last": "Vai all’ultimo gruppo",
    "key-hier-root": "Vai al primo elemento",
    "key-play-fwd-group": "Riproduci i gruppi procedendo in avanti",
    "key-play-back-group": "Riproduci i gruppi procedendo indietro",
    "key-point-first": "Vai al primo punto",
    "key-point-last": "Vai all’ultimo punto",
    "key-replay": "Riproduci di nuovo",
    "key-select": "Seleziona elemento",
    "key-tenth-prev": "Retrocedi di un decimo",
    "key-tenth-next": "Avanza di un decimo",
    "key-level-min": "Vai al valore minimo del livello",
    "key-level-max": "Vai al valore massimo del livello",
    "key-group-min": "Vai al valore minimo del gruppo",
    "key-group-max": "Vai al valore massimo del gruppo",
    "key-chart-min": "Vai al valore minimo del grafico",
    "key-chart-max": "Vai al valore massimo del grafico",
    "key-level-decr": "Scendi di un livello",
    "key-level-incr": "Sali di un livello",
    "key-speed-incr": "Aumenta velocità",
    "key-speed-decr": "Diminuisci velocità",
    "key-monitor-toggle": "Cambia modalità di visualizzazione",
    "key-dialog-help": "Apri finestra di aiuto",
    "key-dialog-options": "Apri opzioni",
    "options-title": "Opzioni",
    "options-frontmatter": "Durante la navigazione nel grafico, alcuni suoni potrebbero essere troppo gravi o troppo acuti per essere sentiti. In questo caso, si può espandere la gamma di suoni disponibili utilizzando i cursori seguenti:",
    "options-hertz-lower": "Toni gravi",
    "options-hertz-upper": "Toni acuti",
    "options-speed-label": "Velocità di riproduzione (premi Q ed E)",
    "options-set-global": "Salva le opzioni per altri grafici della pagina",
    "options-use-continuous": "Utilizza la modalità continua",
    "options-continuous-descr": "La modalità continua cambia il modo in cui i valori vengono riprodotti con le combinazioni Shift+Home e Shift+End",
    "options-point-labels": "Mostra etichette del punto",
    "options-point-labels-before": 'prima dei valori (p. es. "California, 423 970 chilometri quadrati, 39 milioni di persone")',
    "options-point-labels-after": 'dopo i valori (p. es. "423 970 chilometri quadrati, 39 milioni di persone, California")'
};

const dictionary = {
    description: "{title}, daim kab kos siv suab",
    "description-untitled": "Daim kab kos siv suab",
    updated: "{title} hloov tshiab",
    "updated-untitled": "Daim kab kos hloov tshiab",
    missing: "ploj lawm",
    close: "Kaw",
    save: "Tseg",
    tooLow: "tsawg dhau",
    tooHigh: "siab dhau",
    nodeHasChildren: "muaj menyuam kab",
    instructionArrows: "Siv tus yuam sij xub los txav.",
    instructionHierarchy: "Siv Alt + xub nce lossis nqis los hloov qib.",
    instructionLive: "Nias M los hloov hom saib ncaj qha.",
    instructionHotkeys: "Nias H kom pom cov yuam sij ntxiv.",
    "summ-chart": "Daim kab kos siv suab.",
    "summ-chart-live": "Daim kab kos siv suab ncaj qha.",
    "summ-chart-hier": "Daim kab kos siv suab muaj ntau qib.",
    "summ-chart-group": `Daim kab kos siv suab muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    }.`,
    "summ-chart-title": `Daim kab kos siv suab hu ua "{title}".`,
    "summ-chart-live-hier": "Daim kab kos siv suab muaj ntau qib ncaj qha.",
    "summ-chart-live-group": `Daim kab kos siv suab ncaj qha muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    }.`,
    "summ-chart-live-title": `Daim kab kos siv suab ncaj qha hu ua "{title}".`,
    "summ-chart-hier-group": `Daim kab kos siv suab muaj ntau qib muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    }.`,
    "summ-chart-hier-title": `Daim kab kos siv suab muaj ntau qib hu ua "{title}".`,
    "summ-chart-group-title": `Daim kab kos siv suab muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    } hu ua "{title}".`,
    "summ-chart-live-hier-group": `Daim kab kos siv suab muaj ntau qib ncaj qha muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    }.`,
    "summ-chart-live-hier-title": `Daim kab kos siv suab muaj ntau qib ncaj qha hu ua "{title}".`,
    "summ-chart-live-group-title": `Daim kab kos siv suab ncaj qha muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    } hu ua "{title}".`,
    "summ-chart-hier-group-title": `Daim kab kos siv suab muaj ntau qib muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    } hu ua "{title}".`,
    "summ-chart-live-hier-group-title": `Daim kab kos siv suab muaj ntau qib ncaj qha muaj {groupCount, plural,
        =0 {tsis muaj pab}
        one {1 pab}
        other {{groupCount} pab}
    } hu ua "{title}".`,
    "axis-desc": `{letter} yog "{label}" txij {min} mus {max}.`,
    "axis-desc-log": `{letter} yog "{label}" txij {min} mus {max} logarithmic.`,
    "axis-desc-con": `{letter} yog "{label}" txij {min} mus {max} txuas ntxiv.`,
    "axis-desc-log-con": `{letter} yog "{label}" txij {min} mus {max} logarithmic txuas ntxiv.`,
    "kbr-speed": `Ceev, {rate_in_ms}`,
    "kbr-not-live": "Tsis yog daim kab kos ncaj qha",
    monitoring: "Saib xyuas {switch, select, true {qhib} false {tawm} other {tsis paub}}",
    "group-unknown": `Pab hu ua "{title}" siv hom kab kos tsis txhawb.`,
    "chart-line": "Kab kos kab.",
    "chart-bar": "Kab kos kab ntev.",
    "chart-band": "Kab kos band.",
    "chart-pie": "Kab kos ncuav.",
    "chart-candlestick": "Kab kos teeb tswm ciab.",
    "chart-histogram": "Kab kos histogram.",
    "chart-box": "Kab kos lub thawv.",
    "chart-matrix": "Kab kos matrix.",
    "chart-scatter": "Kab kos tawg.",
    "chart-treemap": "Kab kos ntoo daim ntawv.",
    "chart-line-labeled": `Kab kos kab qhia "{label}".`,
    "chart-bar-labeled": `Kab kos kab ntev qhia "{label}".`,
    "chart-band-labeled": `Kab kos band qhia "{label}".`,
    "chart-pie-labeled": `Kab kos ncuav qhia "{label}".`,
    "chart-candlestick-labeled": `Kab kos teeb tswm ciab qhia "{label}".`,
    "chart-histogram-labeled": `Kab kos histogram qhia "{label}".`,
    "chart-box-labeled": `Kab kos lub thawv qhia "{label}".`,
    "chart-matrix-labeled": `Kab kos matrix qhia "{label}".`,
    "chart-scatter-labeled": `Kab kos tawg qhia "{label}".`,
    "chart-treemap-labeled": `Kab kos ntoo daim ntawv qhia "{label}".`,
    "stat-all": "Txhua yam",
    "stat-open": "Qhib",
    "stat-high": "Siab tshaj",
    "stat-low": "Tsawg tshaj",
    "stat-close": "Kaw",
    "stat-q1": "Q1",
    "stat-median": "Nruab nrab",
    "stat-q3": "Q3",
    "stat-outlier": "Tawm txawv",
    "point-xy": "{x}, {y}",
    "point-xohlc": "{x}, {open} - {high} - {low} - {close}",
    "point-outlier": "{x}, {y}, {index} ntawm {count}",
    "point-xhl": "{x}, {high} - {low}",
    "point-xhl-outlier": `{x}, {high} - {low}, nrog {count, plural,
        =0 {tsis muaj txawv}
        one {{count} qhov txawv}
        other {{count} qhov txawv}
    }`,
    "info-open": "Qhib ntaub ntawv",
    "info-title": "Ntaub ntawv",
    "info-notes": "Nco tseg",
    "kbmg-title": "Tus tswj keyboard",
    "key-point-next": "Txav mus rau qhov tom ntej",
    "key-point-prev": "Txav mus rau qhov dhau los",
    "key-play-fwd": "Qhib suab mus rau sab xis",
    "key-play-back": "Qhib suab rov qab rau sab laug",
    "key-play-cancel": "Tso tseg kev qhib suab",
    "key-group-prev": "Txav mus rau pab dhau los",
    "key-stat-prev": "Txav mus rau yam dhau los",
    "key-group-next": "Txav mus rau pab tom ntej",
    "key-stat-next": "Txav mus rau yam tom ntej",
    "key-group-first": "Txav mus rau pab thawj",
    "key-group-last": "Txav mus rau pab kawg",
    "key-hier-root": "Txav mus rau hauv paus",
    "key-play-fwd-group": "Qhib suab mus rau hauv cov pab",
    "key-play-back-group": "Qhib suab rov qab hauv cov pab",
    "key-point-first": "Txav mus rau qhov pib",
    "key-point-last": "Txav mus rau qhov kawg",
    "key-replay": "Qhib suab tam sim no dua",
    "key-select": "Xaiv yam khoom",
    "key-tenth-prev": "Txav sab laug me ntsis",
    "key-tenth-next": "Txav sab xis me ntsis",
    "key-level-min": "Mus rau tus nqi tsawg tshaj",
    "key-level-max": "Mus rau tus nqi siab tshaj",
    "key-group-min": "Mus rau tus nqi tsawg tshaj hauv pab",
    "key-group-max": "Mus rau tus nqi siab tshaj hauv pab",
    "key-chart-min": "Mus rau tus nqi tsawg tshaj ntawm daim kab kos",
    "key-chart-max": "Mus rau tus nqi siab tshaj ntawm daim kab kos",
    "key-level-decr": "Nqes ib qib",
    "key-level-incr": "Nce ib qib",
    "key-speed-incr": "Nce ceev qhib suab",
    "key-speed-decr": "Txo ceev qhib suab",
    "key-monitor-toggle": "Hloov hom saib xyuas",
    "key-dialog-help": "Qhib kev pab",
    "key-dialog-options": "Qhib kev xaiv",
    "key-descr-ArrowRight": "Right arrow",
    "key-descr-ArrowLeft": "Left arrow",
    "key-descr-alt-Home": "Function + Left arrow",
    "key-descr-alt-End": "Function + Right arrow",
    "key-descr-Shift+End": "Shift + End",
    "key-descr-alt-Shift+End": "Shift + Function + Right arrow",
    "key-descr-Shift+Home": "Shift + Home",
    "key-descr-alt-Shift+Home": "Shift + Function + Left arrow",
    "key-descr-ctrl": "Control",
    "key-descr-spacebar": "Spacebar",
    "key-descr-Ctrl+ArrowRight": "Control + Right arrow",
    "key-descr-Ctrl+ArrowLeft": "Control + Left arrow",
    "key-descr-ArrowDown": "Down arrow",
    "key-descr-ArrowUp": "Up arrow",
    "key-descr-PageUp": "Page up",
    "key-descr-PageDown": "Page down",
    "key-descr-alt-PageUp": "Function + Up arrow",
    "key-descr-alt-PageDown": "Function + Down arrow",
    "key-descr-Alt+PageUp": "Alt + Page up",
    "key-descr-alt-Alt+PageUp": "Option + Function + Up arrow",
    "key-descr-Alt+PageDown": "Alt + Page down",
    "key-descr-alt-Alt+PageDown": "Option + Function + Down arrow",
    "key-descr-Shift+PageDown": "Shift + Page down",
    "key-descr-alt-Shift+PageDown": "Shift + Function + Down arrow",
    "key-descr-Shift+PageUp": "Shift + Page up",
    "key-descr-alt-Shift+PageUp": "Shift + Function + Up arrow",
    "key-descr-Ctrl+[": "Control + [",
    "key-descr-Ctrl+]": "Control + ]",
    "key-descr-Alt+ArrowDown": "Alt + Down arrow",
    "key-descr-Alt+ArrowUp": "Alt + Up arrow",
    "help-dialog-front-matter": "Koj siv tau cov yuam sij hauv qab no los txav sai dua hauv daim kab kos. Qee lub keyboard yuav hu txawv lossis siv ob peb tus yuam sij ua ke. Piv txwv, rau Apple keyboard tsis muaj Home, siv Function + xub laug. Thaum ua tau, lwm txoj kev xaiv yuav raug qhia hauv qab no.",
    "help-dialog-footer": "Rau kev paub ntxiv txog kev nkag tau ntawm daim kab kos, thov mus xyuas ",
    "options-title": "Kev xaiv",
    "options-frontmatter": "Yog qee lub suab tsawg dhau lossis siab dhau, siv cov sliders no los kho suab nrov thiab siab:",
    "options-hertz-lower": "Hz qis dua",
    "options-hertz-upper": "Hz siab dua",
    "options-speed-label": "Ceev qhib suab (nias 'Q' thiab 'E')",
    "options-set-global": "Tseg kuv qhov kev xaiv rau lwm daim kab kos",
    "options-use-continuous": "Siv hom txuas ntxiv",
    "options-continuous-descr": "Hom txuas ntxiv hloov txoj kev qhib suab thaum nias Shift+Home thiab Shift+End",
    "options-point-labels": "Qhia npe ntawm cov ntsiab lus",
    "options-point-labels-before": `ua ntej tus nqi (piv txwv: "California, 163,696 square miles, 39 million people")`,
    "options-point-labels-after": `tom qab tus nqi (piv txwv: "163,696 square miles, 39 million people, California")`
};

var translations = /*#__PURE__*/Object.freeze({
    __proto__: null,
    de: dictionary$4,
    en: dictionary$5,
    es: dictionary$3,
    fr: dictionary$2,
    hmn: dictionary,
    it: dictionary$1
});

const DEFAULT_LANGUAGE = "en";
const AVAILABLE_LANGUAGES = Object.keys(translations);
class TranslationManager {
    constructor(language = DEFAULT_LANGUAGE) {
        this._availableLanguageCodes = [];
        this._loadedLanguages = new Map();
        this._intercepterCallback = () => false;
        this._availableLanguageCodes = Object.keys(translations);
        this.language = DEFAULT_LANGUAGE;
        this.language = language;
    }
    get language() {
        return this._language;
    }
    set language(newValue) {
        this._language = newValue;
        if (!this._loadedLanguages.has(newValue)) {
            this.loadLanguage(newValue);
        }
    }
    set intercepterCallback(newValue) {
        this._intercepterCallback = newValue;
    }
    get languages() {
        return this._availableLanguageCodes;
    }
    get loadedLanguages() {
        return [...this._loadedLanguages.keys()];
    }
    loadLanguage(code) {
        if (!(code in translations)) {
            return false;
        }
        this._loadedLanguages.set(code, createIntl({
            locale: code,
            messages: translations[code]
        }));
        return true;
    }
    translate(id, evaluators = {}) {
        const intercepted = this._intercepterCallback({
            language: this._language,
            id,
            evaluators
        });
        if (intercepted !== false) {
            return intercepted;
        }
        if (id in translations[this._language]) {
            return this._loadedLanguages
                .get(this._language)
                .formatMessage({ id }, evaluators);
        }
        if (id in translations[DEFAULT_LANGUAGE]) {
            return this._loadedLanguages
                .get(DEFAULT_LANGUAGE)
                .formatMessage({ id }, evaluators);
        }
        return "";
    }
}

const SUPPORTED_TYPES_LIST = [
    "band",
    "bar",
    "box",
    "candlestick",
    "histogram",
    "line",
    "matrix",
    "pie",
    "scatter",
    "treemap",
    "unsupported"
];

const validateInput = (input) => {
    const errors = [];
    errors.push(validateInputType(input.type));
    errors.push(validateInputLang(input.lang));
    errors.push(validateInputElement(input.element));
    errors.push(validateInputAxes(input.axes));
    errors.push(validateInputDataHomogeneity(input.data));
    errors.push(validateCornerCases(input));
    errors.push(validateHierarchyReferences(input.data, input.options));
    errors.push(validateInputTypeCountsMatchData(input.type, input.data));
    return errors.filter((str) => str !== "").join("\n");
};
const validateInputType = (type) => {
    const supported_types_string = SUPPORTED_TYPES_LIST.join(", ");
    if (typeof type === "undefined") {
        return `Required parameter 'type' was left undefined. Supported types are: ${supported_types_string}`;
    }
    if (Array.isArray(type)) {
        const unsupported_types = type.filter((str) => !SUPPORTED_TYPES_LIST.includes(str));
        if (unsupported_types.length === 0) {
            return "";
        }
        return `Invalid input types: ${unsupported_types.join(", ")}. Valid types are: ${supported_types_string}`;
    }
    if (SUPPORTED_TYPES_LIST.includes(type)) {
        return "";
    }
    return `Invalid input type: ${type}. Valid types are: ${supported_types_string}`;
};
const validateInputLang = (lang) => {
    if (typeof lang === "undefined") {
        return "";
    }
    if (AVAILABLE_LANGUAGES.includes(lang)) {
        return "";
    }
    return `Error: Unrecognized language "${lang}". Available languages: ${AVAILABLE_LANGUAGES.join(", ")}.`;
};
const validateInputTypeCountsMatchData = (type, data) => {
    if (!Array.isArray(type)) {
        return "";
    }
    const keys = Object.keys(data);
    if (type.length === keys.length) {
        return "";
    }
    return `Error: Number of types (${type.length}) and number of data groups (${keys.length}) don't match.`;
};
const validateInputElement = (element) => {
    if (typeof element === "undefined") {
        return "Required parameter 'element' was left undefined. An HTMLElement or SVGElement must be provided for this parameter.";
    }
    if (element instanceof HTMLElement || element instanceof SVGElement) {
        return "";
    }
    return "Provided value for 'element' must be an instance of HTMLElement or SVGElement.";
};
const valid_axis_types = ["linear", "log10"];
const validateInputAxes = (axes) => {
    if (typeof axes === "undefined") {
        return "";
    }
    const supportedAxis = ["x", "y", "y2"];
    const unsupportedAxes = Object.keys(axes).filter((axis) => !supportedAxis.includes(axis));
    if (unsupportedAxes.length > 0) {
        return `Unsupported axes were included: ${unsupportedAxes.join(", ")}. The only supported axes are: ${supportedAxis.join(", ")}.`;
    }
    for (const axis in axes) {
        const thisAxis = axes[axis];
        if (typeof thisAxis.type === "string" &&
            !valid_axis_types.includes(thisAxis.type)) {
            return `Axis ${axis} has an unsupported axis type "${thisAxis.type}". Valid axis types are: ${valid_axis_types.join(", ")}.`;
        }
        if (thisAxis.type === "log10" &&
            (thisAxis.minimum === 0 || thisAxis.maximum === 0)) {
            return `Axis ${axis} has type "log10", but has a minimum or maximum value of 0. No values <= 0 are supported for logarithmic axes.`;
        }
    }
    return "";
};
const validateInputDataHomogeneity = (data) => {
    if (Array.isArray(data)) {
        return validateInputDataRowHomogeneity(data);
    }
    for (const key in data) {
        if (data[key] === null) {
            continue;
        }
        const result = validateInputDataRowHomogeneity(data[key]);
        if (result !== "") {
            return `Error for data category ${key}: ${result}`;
        }
    }
    return "";
};
const validateInputDataRowHomogeneity = (row) => {
    const first = row[0];
    if (typeof first === "number") {
        const failure = row.findIndex((cell) => !(typeof cell === "number"));
        if (failure === -1) {
            return "";
        }
        return `The first item is a number, but item index ${failure} is not (value: ${JSON.stringify(row[failure])}). All items should be of the same type.`;
    }
    if (first.x instanceof Date) {
        return "The first item is a date, which is not a supported format type. Please re-submit with the ms version of the date. For example: `myDate.valueOf()`.";
    }
    if (isSimpleDataPoint(first)) {
        const failure = row.findIndex((cell) => !isSimpleDataPoint(cell));
        if (failure === -1) {
            return "";
        }
        return `The first item is a simple data point (x/y), but item index ${failure} is not (value: ${JSON.stringify(row[failure])}). All items should be of the same type.`;
    }
    if (isAlternateAxisDataPoint(first)) {
        const failure = row.findIndex((cell) => !isAlternateAxisDataPoint(cell));
        if (failure === -1) {
            return "";
        }
        return `The first item is an alternate axis data point (x/y2), but item index ${failure} is not (value: ${JSON.stringify(row[failure])}). All items should be of the same type.`;
    }
    if (isOHLCDataPoint(first)) {
        const failure = row.findIndex((cell) => !isOHLCDataPoint(cell));
        if (failure === -1) {
            return "";
        }
        return `The first item is an OHLC data point (x/open/high/low/close), but item index ${failure} is not (value: ${JSON.stringify(row[failure])}). All items should be of the same type.`;
    }
    if (isBoxDataPoint(first)) {
        const failure = row.findIndex((cell) => !isBoxDataPoint(cell));
        if (failure >= 0) {
            return `The first item is a box data point (x/low/q1/median/q3/high), but item index ${failure} is not (value: ${JSON.stringify(row[failure])}). All items should be of the same type.`;
        }
        const nonArray = row.findIndex((cell) => "outlier" in cell && !Array.isArray(cell.outlier));
        if (nonArray >= 0) {
            return `At least one box provided an outlier that was not an array. An outliers should be an array of numbers. The box is question is: ${JSON.stringify(row[nonArray])}`;
        }
        const nonArrayNumber = row.findIndex((cell) => "outlier" in cell &&
            cell.outlier.findIndex((o) => typeof o !== "number") >= 0);
        if (nonArrayNumber >= 0) {
            return `At least one box has a non-numeric outlier. Box outliers must be an array of numbers. The box in question is: ${JSON.stringify(row[nonArrayNumber])}`;
        }
        return "";
    }
    if (isHighLowDataPoint(first)) {
        const failure = row.findIndex((cell) => !isHighLowDataPoint(cell));
        if (failure === -1) {
            return "";
        }
        return `The first item is a high low data point (x/high/low), but item index ${failure} is not (value: ${JSON.stringify(row[failure])}). All items should be of the same type.`;
    }
    return `The first item is of an unrecognized type (value: ${JSON.stringify(first)}). Supported types are: number, simple data point (x/y), alternative axis data point (x/y2), and high low data point (x/high/low).`;
};
const validateCornerCases = (input) => {
    if (input.element instanceof HTMLImageElement &&
        typeof input.cc === "undefined") {
        return "Error: If the target element is an IMG element, a CC property must be specified.";
    }
    return "";
};
const validateHierarchyReferences = (data, options = {}) => {
    const { root } = options;
    if (!root) {
        return "";
    }
    if (Array.isArray(data)) {
        return `Unexpected data structure. options.root="${root}", but "${root}" is not a key in data.
        Data is: ${JSON.stringify(data).replace(/^.{0,100}(.+)$/, "...")}`;
    }
    const groupNames = Object.keys(data);
    if (!groupNames.includes(root)) {
        return `Root points to group '${root}', but that group doesn't exist. Valid root values are: ${groupNames.join(", ")}.`;
    }
    const groups = Object.values(data);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        const groupName = groupNames[groupIndex];
        const omitter = (n) => n !== groupName && n !== root;
        if (!Array.isArray(group)) {
            continue;
        }
        for (let cell = 0; cell < group.length; cell++) {
            if (typeof group[cell] !== "object") {
                continue;
            }
            const { children } = group[cell];
            if (!children) {
                continue;
            }
            if (typeof children !== "string") {
                return `Error: Group '${groupName}', point index ${cell}: Expected property 'children' to be of type string. Instead, it was of type '${typeof children}'.`;
            }
            if (!groupNames.includes(children)) {
                return `Error: Group '${groupName}', point index ${cell}: Property 'children' has value '${children}'. Unfortunately, that is not a valid value. Valid values are: ${groupNames
                    .filter(omitter)
                    .join(", ")}.`;
            }
            if (children === groupName) {
                return `Error: Group '${groupName}', point index ${cell}: Property 'children' has value '${children}'. Unfortunately, children are not allowed to refer to their own group. Valid values are: ${groupNames
                    .filter(omitter)
                    .join(", ")}.`;
            }
            if (children === root) {
                return `Error: Group '${groupName}', point index ${cell}: Property 'children' is pointing to the root value, which is invalid. Valid values are: ${groupNames
                    .filter(omitter)
                    .join(", ")}.`;
            }
        }
    }
    return "";
};

const launchOptionDialog = ({ language, upper, lower, speedIndex, continuousMode, labelPosition, translationCallback }, cb, playCb) => {
    const dialog = document.createElement("dialog");
    dialog.classList.add("chart2music-dialog");
    dialog.classList.add("chart2music-option-dialog");
    dialog.setAttribute("lang", language);
    const translatedOptionsTitle = translationCallback("options-title");
    dialog.setAttribute("aria-label", translatedOptionsTitle);
    const h1 = dialog.appendChild(document.createElement("h1"));
    h1.textContent = translatedOptionsTitle;
    const p = dialog.appendChild(document.createElement("p"));
    p.textContent = translationCallback("options-frontmatter");
    p.tabIndex = 0;
    const form = dialog.appendChild(document.createElement("form"));
    form.id = "optionForm";
    let div, label, input;
    div = form.appendChild(document.createElement("div"));
    label = div.appendChild(document.createElement("label"));
    label.appendChild(document.createTextNode(translationCallback("options-hertz-lower") + ":"));
    input = label.appendChild(document.createElement("input"));
    input.type = "range";
    input.min = "0";
    input.max = (upper - 1).toString();
    input.step = "1";
    input.id = "lowerRange";
    input.value = lower.toString();
    div = form.appendChild(document.createElement("div"));
    label = div.appendChild(document.createElement("label"));
    label.appendChild(document.createTextNode(translationCallback("options-hertz-upper") + ":"));
    input = label.appendChild(document.createElement("input"));
    input.type = "range";
    input.min = (lower + 1).toString();
    input.max = (HERTZ.length - 1).toString();
    input.step = "1";
    input.id = "upperRange";
    input.value = upper.toString();
    div = form.appendChild(document.createElement("div"));
    label = div.appendChild(document.createElement("label"));
    label.appendChild(document.createTextNode(translationCallback("options-speed-label") + ":"));
    input = label.appendChild(document.createElement("input"));
    input.type = "range";
    input.min = "0";
    input.max = "4";
    input.id = "speedRange";
    input.value = speedIndex.toString();
    div = form.appendChild(document.createElement("div"));
    label = div.appendChild(document.createElement("label"));
    input = label.appendChild(document.createElement("input"));
    input.type = "checkbox";
    input.id = "global";
    input.defaultChecked = true;
    label.appendChild(document.createTextNode(translationCallback("options-set-global")));
    div = form.appendChild(document.createElement("div"));
    label = div.appendChild(document.createElement("label"));
    input = label.appendChild(document.createElement("input"));
    input.type = "checkbox";
    input.id = "continuous";
    input.defaultChecked = continuousMode;
    label.appendChild(document.createTextNode(translationCallback("options-use-continuous")));
    div.appendChild(document.createElement("br"));
    div.appendChild(document.createTextNode(translationCallback("options-continuous-descr")));
    div = form.appendChild(document.createElement("div"));
    const fieldset = div.appendChild(document.createElement("fieldset"));
    const legend = fieldset.appendChild(document.createElement("label"));
    legend.appendChild(document.createTextNode(translationCallback("options-point-labels")));
    label = fieldset.appendChild(document.createElement("label"));
    input = label.appendChild(document.createElement("input"));
    input.type = "radio";
    input.name = "point-labels";
    input.value = "before";
    input.defaultChecked = labelPosition;
    label.appendChild(document.createTextNode(translationCallback("options-point-labels-before")));
    fieldset.appendChild(document.createElement("br"));
    label = fieldset.appendChild(document.createElement("label"));
    input = label.appendChild(document.createElement("input"));
    input.type = "radio";
    input.name = "point-labels";
    input.value = "after";
    input.defaultChecked = !labelPosition;
    label.appendChild(document.createTextNode(translationCallback("options-point-labels-after")));
    input = form.appendChild(document.createElement("input"));
    input.type = "submit";
    input.id = "save";
    input.value = translationCallback("save");
    const lowerRange = dialog.querySelector("#lowerRange");
    const upperRange = dialog.querySelector("#upperRange");
    const speedRange = dialog.querySelector("#speedRange");
    const global = dialog.querySelector("#global");
    const continuous = dialog.querySelector("#continuous");
    const save = () => {
        const lowerValue = Number(lowerRange.value);
        const upperValue = Number(upperRange.value);
        const speedIndex = Number(speedRange.value);
        const saveGlobal = global.checked;
        const continuousChecked = continuous.checked;
        const labelRadioButton = dialog.querySelector("input[name='point-labels']:checked");
        const labelPosition = labelRadioButton.value === "before";
        cb(lowerValue, upperValue, speedIndex, continuousChecked, labelPosition);
        if (window && saveGlobal) {
            if (!window.__chart2music_options__) {
                window.__chart2music_options__ = {};
            }
            window.__chart2music_options__ = {
                _hertzClamps: {
                    lower: lowerValue,
                    upper: upperValue
                }
            };
        }
        dialog.close();
    };
    Array.from(dialog.querySelectorAll("input")).forEach((elem) => {
        elem.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                save();
            }
        });
    });
    dialog.querySelector("#optionForm").addEventListener("submit", (e) => {
        e.preventDefault();
        save();
    });
    dialog.querySelector("#save").addEventListener("click", (e) => {
        e.preventDefault();
        save();
    });
    if (playCb) {
        lowerRange.addEventListener("change", () => {
            playCb(Number(lowerRange.value));
            upperRange.min = String(Number(lowerRange.value) + 1);
        });
        upperRange.addEventListener("change", () => {
            playCb(Number(upperRange.value));
            lowerRange.max = String(Number(upperRange.value) - 1);
        });
    }
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.focus();
    dialog.addEventListener("close", () => {
        dialog.parentElement.removeChild(dialog);
    });
};

const launchInfoDialog = (info, translationCallback) => {
    const dialog = document.createElement("dialog");
    dialog.classList.add("chart2music-dialog");
    dialog.classList.add("chart2music-info-dialog");
    const translatedInfoTitle = translationCallback("info-title");
    dialog.setAttribute("aria-label", translatedInfoTitle);
    const h1 = dialog.appendChild(document.createElement("h1"));
    h1.tabIndex = 0;
    h1.textContent = translatedInfoTitle;
    if ("notes" in info) {
        const h2 = dialog.appendChild(document.createElement("h2"));
        h2.textContent = translationCallback("info-notes");
        const ul = dialog.appendChild(document.createElement("ul"));
        info.notes.forEach((str) => {
            const li = ul.appendChild(document.createElement("li"));
            li.textContent = str;
        });
    }
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.focus();
    dialog.addEventListener("close", () => {
        dialog.parentElement.removeChild(dialog);
    });
};

var ActionSet;
(function (ActionSet) {
    ActionSet["NEXT_POINT"] = "next_point";
    ActionSet["PREVIOUS_POINT"] = "previous_point";
    ActionSet["PLAY_RIGHT"] = "play_right";
    ActionSet["PLAY_LEFT"] = "play_left";
    ActionSet["PLAY_FORWARD_CATEGORY"] = "play_forward_category";
    ActionSet["PLAY_BACKWARD_CATEGORY"] = "play_backward_category";
    ActionSet["STOP_PLAY"] = "stop_play";
    ActionSet["PREVIOUS_STAT"] = "previous_stat";
    ActionSet["NEXT_STAT"] = "next_stat";
    ActionSet["PREVIOUS_CATEGORY"] = "previous_category";
    ActionSet["NEXT_CATEGORY"] = "next_category";
    ActionSet["FIRST_CATEGORY"] = "first_category";
    ActionSet["LAST_CATEGORY"] = "last_category";
    ActionSet["FIRST_POINT"] = "first_point";
    ActionSet["LAST_POINT"] = "last_point";
    ActionSet["REPLAY"] = "replay";
    ActionSet["SELECT"] = "select";
    ActionSet["PREVIOUS_TENTH"] = "previous_tenth";
    ActionSet["NEXT_TENTH"] = "next_tenth";
    ActionSet["GO_MINIMUM"] = "go_minimum";
    ActionSet["GO_MAXIMUM"] = "go_maximum";
    ActionSet["GO_TOTAL_MINIMUM"] = "go_total_minimum";
    ActionSet["GO_TOTAL_MAXIMUM"] = "go_total_maximum";
    ActionSet["DRILL_DOWN"] = "drill_down";
    ActionSet["DRILL_UP"] = "drill_up";
    ActionSet["GO_TO_ROOT"] = "go_to_root";
    ActionSet["SPEED_UP"] = "speed_up";
    ActionSet["SLOW_DOWN"] = "slow_down";
    ActionSet["MONITOR"] = "monitor";
    ActionSet["HELP"] = "help";
    ActionSet["OPTIONS"] = "options";
    ActionSet["INFO"] = "info";
})(ActionSet || (ActionSet = {}));
let context = null;
const c2mChart = (input) => {
    const validationErrorString = validateInput(input);
    if (validationErrorString !== "") {
        return { err: validationErrorString };
    }
    return {
        err: null,
        data: new c2m(input)
    };
};
class c2m {
    constructor(input) {
        this._visible_group_indices = [];
        this._visibleGroupIndex = 0;
        this._pointIndex = 0;
        this._playListInterval = null;
        this._playListContinuous = [];
        this._speedRateIndex = 1;
        this._flagNewLevel = false;
        this._flagNewStat = false;
        this._audioEngine = null;
        this._options = {
            enableSound: true,
            enableSpeech: true,
            live: false,
            hertzes: HERTZ,
            stack: false,
            root: null,
            modifyHelpDialogText: (lang, text) => text,
            modifyHelpDialogKeyboardListing: (lang, headers, shortcuts) => [headers].concat(shortcuts)
        };
        this._monitorMode = false;
        this._explicitAxes = {};
        this._hertzClamps = {
            upper: HERTZ.length - 12,
            lower: 21
        };
        this._silent = false;
        this._outlierIndex = 0;
        this._outlierMode = false;
        this._announcePointLabelFirst = false;
        this._info = {};
        this._hierarchy = false;
        this._hierarchyRoot = null;
        this._hierarchyBreadcrumbs = [];
        this._cleanUpTasks = [];
        if (detectIfMobile()) {
            return;
        }
        this._type = input.type;
        this._providedAudioEngine = input.audioEngine;
        this._title = input.title ?? "";
        this._chartElement = input.element;
        this._info = input.info ?? {};
        this._language = input.lang ?? DEFAULT_LANGUAGE;
        this._translator = new TranslationManager(this._language);
        this._ccElement = determineCC(this._chartElement, (fn) => {
            this._cleanUpTasks.push(fn);
        }, input.cc);
        if (input?.options) {
            if (this._type === "scatter") {
                this._options.stack = true;
            }
            this._options = {
                ...this._options,
                ...input?.options
            };
            if (input.options.hertzes) {
                this._hertzClamps = {
                    upper: input.options.hertzes.length - 1,
                    lower: 0
                };
            }
            if (input.options.translationCallback) {
                this._translator.intercepterCallback =
                    input.options.translationCallback;
            }
        }
        prepChartElement({
            elem: this._chartElement,
            title: this._title,
            translationCallback: (code, evaluators) => {
                return this._translator.translate(code, evaluators);
            },
            addCleanupTask: (fn) => {
                this._cleanUpTasks.push(fn);
            }
        });
        this._setData(input.data, input.axes);
        if (this._options.root) {
            this._hierarchy = true;
            this._hierarchyRoot = this._options.root;
            this._updateToNewLevel(this._groups.indexOf(this._hierarchyRoot));
        }
        this._generateSummary();
        ScreenReaderBridge.addAriaAttributes(this._ccElement);
        this._ccElement.setAttribute("lang", this._language);
        this._sr = new ScreenReaderBridge(this._ccElement);
        this._availableActions = this._initializeActionMap();
        this._initializeKeyActionMap();
        this._startListening();
    }
    static get languages() {
        return AVAILABLE_LANGUAGES;
    }
    get _groupIndex() {
        return this._visible_group_indices.at(this._visibleGroupIndex);
    }
    cleanUp() {
        this._cleanUpTasks.forEach((fn) => fn());
    }
    get _currentGroupType() {
        if (Array.isArray(this._type)) {
            return this._type.at(this._visibleGroupIndex);
        }
        else {
            return this._type;
        }
    }
    get _currentDataRow() {
        return this._data.at(this._groupIndex);
    }
    get _movementAvailable() {
        if (this._currentDataRow === null) {
            return false;
        }
        return true;
    }
    get currentPoint() {
        if (this._currentDataRow === null) {
            return null;
        }
        return this._currentDataRow.at(this._pointIndex);
    }
    get _currentGroupName() {
        return this._groups.at(this._groupIndex);
    }
    _clearPlay() {
        clearInterval(this._playListInterval);
        this._playListContinuous.forEach((item) => {
            clearTimeout(item);
        });
        this._playListContinuous = [];
    }
    _initializeActionMap() {
        return {
            next_point: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                if (this._moveRight()) {
                    this._playAndSpeak();
                }
            },
            previous_point: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                if (this._moveLeft()) {
                    this._playAndSpeak();
                }
            },
            drill_down: () => {
                this._clearPlay();
                if (this._drillDown()) {
                    this._playAndSpeak();
                }
            },
            drill_up: () => {
                this._clearPlay();
                if (this._drillUp()) {
                    this._playAndSpeak();
                }
            },
            go_to_root: () => {
                this._clearPlay();
                if (this._drillToRoot()) {
                    this._playAndSpeak();
                }
            },
            play_right: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._playRight();
            },
            play_left: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._playLeft();
            },
            play_forward_category: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                const max = this._visible_group_indices.length - 1;
                this._playListInterval = setInterval(() => {
                    if (this._visibleGroupIndex >= max) {
                        this._visibleGroupIndex = max;
                        this._clearPlay();
                    }
                    else {
                        this._visibleGroupIndex++;
                        this._playCurrent();
                    }
                }, SPEEDS.at(this._speedRateIndex));
                this._playCurrent();
            },
            play_backward_category: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                const min = 0;
                this._playListInterval = setInterval(() => {
                    if (this._visibleGroupIndex <= min) {
                        this._visibleGroupIndex = min;
                        this._clearPlay();
                    }
                    else {
                        this._visibleGroupIndex--;
                        this._playCurrent();
                    }
                }, SPEEDS.at(this._speedRateIndex));
                this._playCurrent();
            },
            stop_play: () => {
                this._clearPlay();
            },
            previous_stat: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                if (this._movePrevStat()) {
                    this._flagNewStat = true;
                    this._playAndSpeak();
                }
            },
            next_stat: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                if (this._moveNextStat()) {
                    this._flagNewStat = true;
                    this._playAndSpeak();
                }
            },
            previous_category: () => {
                this._clearPlay();
                if (this._visibleGroupIndex === 0) {
                    return;
                }
                const currentX = this.currentPoint?.x ?? this._pointIndex;
                this._visibleGroupIndex--;
                this._announceCategoryChange();
                this._cleanupAfterCategoryChange(currentX);
                this._onFocus();
            },
            next_category: () => {
                this._clearPlay();
                if (this._visibleGroupIndex ===
                    this._visible_group_indices.length - 1) {
                    return;
                }
                const currentX = this.currentPoint.x;
                this._visibleGroupIndex++;
                this._announceCategoryChange();
                this._cleanupAfterCategoryChange(currentX);
                this._onFocus();
            },
            first_category: () => {
                this._clearPlay();
                this._visibleGroupIndex = 0;
                this._playAndSpeak();
            },
            last_category: () => {
                this._clearPlay();
                this._visibleGroupIndex =
                    this._visible_group_indices.length - 1;
                this._playAndSpeak();
            },
            first_point: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._pointIndex = 0;
                this._playAndSpeak();
            },
            last_point: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._pointIndex = this._currentDataRow.length - 1;
                this._playAndSpeak();
            },
            replay: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._flagNewStat = true;
                this._playAndSpeak();
            },
            select: () => {
                if (!this._movementAvailable) {
                    return;
                }
                this._options.onSelectCallback?.({
                    slice: this._currentGroupName,
                    index: this._pointIndex,
                    point: this.currentPoint
                });
            },
            previous_tenth: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._moveLeftTenths();
                this._playAndSpeak();
            },
            next_tenth: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                this._moveRightTenths();
                this._playAndSpeak();
            },
            go_minimum: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                if (this._moveToMinimum()) {
                    this._playAndSpeak();
                }
            },
            go_maximum: () => {
                this._clearPlay();
                if (!this._movementAvailable) {
                    return;
                }
                if (this._moveToMaximum()) {
                    this._playAndSpeak();
                }
            },
            go_total_maximum: () => {
                this._clearPlay();
                const winner = this._metadataByGroup
                    .filter((g, index) => this._visible_group_indices.includes(index))
                    .reduce((previousValue, currentValue) => {
                    return previousValue.maximumValue >
                        currentValue.maximumValue
                        ? previousValue
                        : currentValue;
                });
                if (!winner) {
                    return;
                }
                this._visibleGroupIndex = this._visible_group_indices.indexOf(winner.index);
                this._pointIndex = winner.maximumPointIndex;
                this._playAndSpeak();
            },
            go_total_minimum: () => {
                this._clearPlay();
                const winner = this._metadataByGroup
                    .filter((g, index) => this._visible_group_indices.includes(index))
                    .reduce((previousValue, currentValue) => {
                    return previousValue.minimumValue <
                        currentValue.minimumValue
                        ? previousValue
                        : currentValue;
                });
                if (!winner) {
                    return;
                }
                this._visibleGroupIndex = this._visible_group_indices.indexOf(winner.index);
                this._pointIndex = winner.minimumPointIndex;
                this._playAndSpeak();
            },
            speed_up: () => {
                this._clearPlay();
                if (this._speedRateIndex < SPEEDS.length - 1) {
                    this._speedRateIndex++;
                }
                this._sr.render(this._translator.translate("kbr-speed", {
                    rate_in_ms: SPEEDS.at(this._speedRateIndex)
                }));
            },
            slow_down: () => {
                this._clearPlay();
                if (this._speedRateIndex > 0) {
                    this._speedRateIndex--;
                }
                this._sr.render(this._translator.translate("kbr-speed", {
                    rate_in_ms: SPEEDS.at(this._speedRateIndex)
                }));
            },
            monitor: () => {
                if (!this._options.live) {
                    this._sr.render(this._translator.translate("kbr-not-live"));
                    return;
                }
                this._monitorMode = !this._monitorMode;
                this._sr.render(this._translator.translate("monitoring", {
                    switch: this._monitorMode
                }));
            },
            help: () => {
                this._clearPlay();
                this._keyEventManager.launchHelpDialog(this._language, (id, ev) => this._translator.translate(id, ev));
            },
            options: () => {
                this._checkAudioEngine();
                launchOptionDialog({
                    ...this._hertzClamps,
                    speedIndex: this._speedRateIndex,
                    continuousMode: this._xAxis.continuous,
                    labelPosition: this._announcePointLabelFirst,
                    language: this._language,
                    translationCallback: (id, ev) => this._translator.translate(id, ev)
                }, (lowerIndex, upperIndex, speedIndex, continuousMode, labelPosition) => {
                    this._setHertzClamps(lowerIndex, upperIndex);
                    if (this._speedRateIndex !== speedIndex) {
                        this._speedRateIndex = speedIndex;
                        this._sr.render(this._translator.translate("kbr-speed", {
                            rate_in_ms: SPEEDS.at(this._speedRateIndex)
                        }));
                    }
                    if (this._xAxis.continuous !== continuousMode) {
                        this._xAxis.continuous = continuousMode;
                        this._generateSummary();
                    }
                    this._announcePointLabelFirst = labelPosition;
                }, (hertzIndex) => {
                    this._audioEngine?.playDataPoint(this._options.hertzes.at(hertzIndex), 0, NOTE_LENGTH);
                });
            },
            info: () => {
                launchInfoDialog(this._info, (id, ev) => this._translator.translate(id, ev));
            }
        };
    }
    _cleanupAfterCategoryChange(previousX) {
        if (this._currentDataRow === null) {
            return;
        }
        if (this._xAxis.continuous &&
            (!this.currentPoint || this.currentPoint.x !== previousX)) {
            const differences = this._currentDataRow.map(({ x }) => Math.abs(previousX - x));
            const smallestDifference = Math.min(...differences);
            const closestIndex = differences.indexOf(smallestDifference);
            this._pointIndex = closestIndex;
        }
        if (this._pointIndex >= this._currentDataRow.length) {
            this._pointIndex = this._currentDataRow.length - 1;
        }
    }
    _generateSummary() {
        this._chartSummary = generateChartSummary({
            title: this._title,
            groupCount: this._visible_group_indices.length,
            live: this._options.live,
            hierarchy: this._hierarchy,
            translationCallback: (code, evaluators) => {
                return this._translator.translate(code, evaluators);
            }
        });
        this._instructions = generateInstructions({
            live: this._options.live,
            hierarchy: this._hierarchy,
            hasNotes: this._info?.notes?.length > 0,
            translationCallback: (code, evaluators) => {
                return this._translator.translate(code, evaluators);
            }
        });
    }
    _createFrequencyTable(rowFilter) {
        const freqTable = {};
        this._data.forEach((row, rowIndex) => {
            if (rowFilter && !rowFilter(row, rowIndex)) {
                return;
            }
            row.forEach((cell) => {
                if (!isSimpleDataPoint(cell)) {
                    return;
                }
                if (!(cell.x in freqTable)) {
                    freqTable[cell.x] = 0;
                }
                freqTable[cell.x] += cell.y;
            });
        });
        return Object.entries(freqTable).map(([x, y]) => {
            return { x: Number(x), y };
        });
    }
    _buildStackBar() {
        const newRow = this._createFrequencyTable();
        this._data.unshift(newRow);
        this._groups.unshift("All");
        this._visible_group_indices.push(this._groups.length - 1);
    }
    _buildStackScatter() {
        const newGroup = this._data.flat();
        this._data.unshift(newGroup);
        this._groups.unshift("All");
        this._visible_group_indices.push(this._groups.length - 1);
    }
    _setData(data, axes) {
        this._explicitAxes = {
            x: {
                ...(this._explicitAxes.x ?? {}),
                ...(axes?.x ?? {})
            },
            y: {
                ...(this._explicitAxes.y ?? {}),
                ...(axes?.y ?? {})
            },
            y2: {
                ...(this._explicitAxes.y2 ?? {}),
                ...(axes?.y2 ?? {})
            }
        };
        this._initializeData(data);
        if (this._options.stack && this._data.length > 1) {
            if (this._type === "scatter") {
                this._buildStackScatter();
            }
            else {
                this._buildStackBar();
            }
        }
        this._xAxis = initializeAxis({
            data: this._data,
            axisName: "x",
            userAxis: this._explicitAxes.x,
            filterGroupIndex: this._groups.indexOf(this._options.root)
        });
        this._yAxis = initializeAxis({
            data: this._data,
            axisName: "y",
            userAxis: this._explicitAxes.y,
            filterGroupIndex: this._groups.indexOf(this._options.root)
        });
        if (usesAxis({ data: this._data, axisName: "y2" })) {
            this._y2Axis = initializeAxis({
                data: this._data,
                axisName: "y2",
                userAxis: this._explicitAxes.y2
            });
        }
        if (this._type === "scatter" &&
            !("continuous" in this._explicitAxes.x)) {
            this._xAxis.continuous = true;
        }
        if (this._xAxis.continuous) {
            this._data.forEach((row, index) => {
                this._data[index] = row.sort((a, b) => {
                    if (a.x < b.x) {
                        return -1;
                    }
                    if (a.x > b.x) {
                        return 1;
                    }
                    if ("y" in a && "y" in b) {
                        if (a.y < b.y) {
                            return -1;
                        }
                        if (a.y > b.y) {
                            return 1;
                        }
                    }
                    return 0;
                });
            });
        }
        if (this._info.annotations?.length > 0) {
            const annos = this._info.annotations.map(({ x, label }) => {
                return {
                    x,
                    label,
                    y: NaN,
                    type: "annotation",
                    custom: {
                        datasetIndex: 0,
                        index: 0
                    }
                };
            });
            this._data.forEach((group, i) => {
                annos.forEach((a) => {
                    const index = group.findIndex((g) => g.x >= a.x);
                    if (index === -1) {
                        this._data[i].push(a);
                        return;
                    }
                    if (index === 0) {
                        this._data[i].unshift(a);
                        return;
                    }
                    this._data[i].splice(index, 0, a);
                });
            });
        }
        this._metadataByGroup = calculateMetadataByGroup(this._data);
        this._metadataByGroup = checkForNumberInput(this._metadataByGroup, data);
        this._generateSummary();
    }
    setData(data, axes, pointIndex, groupName) {
        const currentStat = this.getCurrent().stat;
        this._setData(data, axes);
        this._pointIndex = Math.min(Math.max(pointIndex ?? 0, 0), this._data[0].length - 1);
        this._visibleGroupIndex =
            this._visible_group_indices[Math.max(this._groups.indexOf(groupName), 0)];
        if (currentStat !== "") {
            this._metadataByGroup[this._groupIndex].statIndex = Math.max(0, this._metadataByGroup[this._groupIndex].availableStats.indexOf(currentStat));
        }
        if (this._title) {
            this._sr.render(this._translator.translate("updated", { title: this._title }));
        }
        else {
            this._sr.render(this._translator.translate("updated-untitled"));
        }
    }
    setCategoryVisibility(name, state) {
        const groupIndex = this._groups.indexOf(name);
        if (groupIndex === -1) {
            return `Unknown group named "${name}". Available groups are: "${this._groups.join('", "')}".`;
        }
        const visibleGroupIndex = this._visible_group_indices.indexOf(groupIndex);
        if (state) {
            if (!this._visible_group_indices.includes(groupIndex)) {
                this._visible_group_indices.push(groupIndex);
                this._visible_group_indices.sort();
                this._sr.render(this._translator.translate("updated", {
                    title: this._title || "Chart"
                }));
            }
        }
        else {
            if (this._visible_group_indices.includes(groupIndex)) {
                if (this._visible_group_indices.length === 1) {
                    return `Group "${name}" can not be hidden. It is the last visible group, and there must always be at least one group visible.`;
                }
                this._visible_group_indices.splice(this._visible_group_indices.indexOf(groupIndex), 1);
                this._sr.render(this._translator.translate("updated", {
                    title: this._title || "Chart"
                }));
            }
        }
        if (this._options.stack && this._groups[0] === "All") {
            this._data[0] = this._createFrequencyTable((row, rowIndex) => {
                return (rowIndex !== 0 &&
                    this._visible_group_indices.includes(rowIndex));
            });
        }
        if (this._visibleGroupIndex >= this._visible_group_indices.length) {
            this._visibleGroupIndex = this._visible_group_indices.length - 1;
        }
        if (this._visibleGroupIndex === visibleGroupIndex) {
            this._silent = true;
            this._availableActions.previous_category();
            if (visibleGroupIndex > 0)
                this._availableActions.next_category();
            this._silent = false;
        }
        return "";
    }
    getCurrent() {
        const { statIndex, availableStats } = this._metadataByGroup[this._groupIndex];
        return {
            index: this._pointIndex,
            group: this._currentGroupName,
            point: this.currentPoint,
            stat: availableStats[statIndex] ?? ""
        };
    }
    _shrinkToMaxWidth() {
        if (typeof this._options.maxWidth === "undefined") {
            return;
        }
        let recalculateX = false, recalculateY = false, recalculateY2 = false;
        for (let i = 0; i < this._data.length; i++) {
            if (this._data[i].length <= this._options.maxWidth) {
                continue;
            }
            const tmp = this._data[i].shift();
            this._pointIndex--;
            if (this._xAxis.minimum === tmp.x ||
                this._xAxis.maximum === tmp.x) {
                recalculateX = true;
            }
            recalculateY = true;
            if (isAlternateAxisDataPoint(tmp)) {
                recalculateY2 = true;
            }
            const targetType = this._metadataByGroup[i].inputType;
            if (targetType === "number") {
                this._data[i].forEach((item, index) => {
                    this._data[i][index].x = index;
                });
            }
        }
        if (recalculateX) {
            this._xAxis.minimum = calculateAxisMinimum({
                data: this._data,
                prop: "x"
            });
            this._xAxis.maximum = calculateAxisMaximum({
                data: this._data,
                prop: "x"
            });
        }
        if (recalculateY) {
            this._yAxis.minimum = calculateAxisMinimum({
                data: this._data,
                prop: "y"
            });
            this._yAxis.maximum = calculateAxisMaximum({
                data: this._data,
                prop: "y"
            });
        }
        if (recalculateY2) {
            this._y2Axis.minimum = calculateAxisMinimum({
                data: this._data,
                prop: "y2"
            });
            this._y2Axis.maximum = calculateAxisMaximum({
                data: this._data,
                prop: "y2"
            });
        }
        if (this._pointIndex < 0) {
            this._pointIndex = 0;
        }
    }
    appendData(dataPoint, group) {
        const groupIndex = group ? this._groups.indexOf(group) : 0;
        if (groupIndex === -1) {
            return {
                err: `Error adding data to unknown group name "${group}". ${this._groups.length === 1
                    ? "There are no group names."
                    : `Valid groups: ${this._groups.join(", ")}`} `
            };
        }
        const addedType = detectDataPointType(dataPoint);
        const targetType = this._metadataByGroup[groupIndex].inputType;
        if (addedType !== targetType) {
            return {
                err: `Mismatched type error. Trying to add data of type ${addedType} to target data of type ${targetType}.`
            };
        }
        const newDataPoint = typeof dataPoint === "number"
            ? {
                x: this._data[groupIndex].length,
                y: dataPoint
            }
            : dataPoint;
        this._data[groupIndex].push(newDataPoint);
        this._xAxis.maximum = Math.max(this._xAxis.maximum, newDataPoint.x);
        if (isSimpleDataPoint(newDataPoint)) {
            this._yAxis.maximum = Math.max(this._yAxis.maximum, newDataPoint.y);
            this._yAxis.minimum = Math.min(this._yAxis.minimum, newDataPoint.y);
        }
        else if (isOHLCDataPoint(newDataPoint)) {
            this._yAxis.maximum = Math.max(this._yAxis.maximum, newDataPoint.open, newDataPoint.high, newDataPoint.low, newDataPoint.close);
            this._yAxis.minimum = Math.min(this._yAxis.minimum, newDataPoint.open, newDataPoint.high, newDataPoint.low, newDataPoint.close);
        }
        else if (isHighLowDataPoint(newDataPoint)) {
            this._yAxis.maximum = Math.max(this._yAxis.maximum, newDataPoint.high, newDataPoint.low);
            this._yAxis.minimum = Math.min(this._yAxis.minimum, newDataPoint.high, newDataPoint.low);
        }
        if (this._monitorMode) {
            const { statIndex, availableStats } = this._metadataByGroup[groupIndex];
            this._playDataPoint(newDataPoint, statIndex, availableStats);
        }
        this._shrinkToMaxWidth();
        return {
            err: null,
            data: newDataPoint
        };
    }
    _initializeKeyActionMap() {
        this._keyEventManager = new KeyboardEventManager(this._chartElement, this._options.modifyHelpDialogText, this._options.modifyHelpDialogKeyboardListing);
        this._keyEventManager.registerKeyEvents([
            {
                title: this._translator.translate("key-point-next"),
                key: "ArrowRight",
                keyDescription: this._translator.translate("key-descr-ArrowRight"),
                callback: this._availableActions.next_point
            },
            {
                title: this._translator.translate("key-point-prev"),
                key: "ArrowLeft",
                keyDescription: this._translator.translate("key-descr-ArrowLeft"),
                callback: this._availableActions.previous_point
            },
            {
                title: this._translator.translate("key-point-first"),
                key: "Home",
                description: this._translator.translate("key-descr-alt-Home"),
                callback: this._availableActions.first_point
            },
            {
                title: this._translator.translate("key-point-last"),
                key: "End",
                description: this._translator.translate("key-descr-alt-Home"),
                callback: this._availableActions.last_point
            },
            {
                title: this._translator.translate("key-play-fwd"),
                key: "Shift+End",
                keyDescription: this._translator.translate("key-descr-Shift+End"),
                description: this._translator.translate("key-descr-alt-Shift+End"),
                callback: this._availableActions.play_right
            },
            {
                title: this._translator.translate("key-play-back"),
                key: "Shift+Home",
                keyDescription: this._translator.translate("key-descr-Shift+Home"),
                description: this._translator.translate("key-descr-alt-Shift+Home"),
                callback: this._availableActions.play_left
            },
            {
                title: this._translator.translate("key-play-cancel"),
                key: "Ctrl+Control",
                keyDescription: this._translator.translate("key-descr-ctrl"),
                callback: this._availableActions.stop_play
            },
            {
                title: this._translator.translate("key-speed-incr"),
                caseSensitive: false,
                key: "q",
                keyDescription: "Q",
                callback: this._availableActions.speed_up
            },
            {
                title: this._translator.translate("key-speed-decr"),
                caseSensitive: false,
                key: "e",
                keyDescription: "E",
                callback: this._availableActions.slow_down
            },
            {
                title: this._translator.translate("key-replay"),
                key: " ",
                keyDescription: this._translator.translate("key-descr-spacebar"),
                callback: this._availableActions.replay
            },
            {
                title: this._translator.translate("key-select"),
                key: "Enter",
                callback: this._availableActions.select
            },
            {
                title: this._translator.translate("key-tenth-next"),
                key: "Ctrl+ArrowRight",
                keyDescription: this._translator.translate("key-descr-Ctrl+ArrowRight"),
                callback: this._availableActions.next_tenth
            },
            {
                title: this._translator.translate("key-tenth-prev"),
                key: "Ctrl+ArrowLeft",
                keyDescription: this._translator.translate("key-descr-Ctrl+ArrowLeft"),
                callback: this._availableActions.previous_tenth
            },
            this._type === "matrix"
                ? {
                    title: this._translator.translate("key-group-next"),
                    key: "ArrowDown",
                    keyDescription: this._translator.translate("key-descr-ArrowDown"),
                    callback: this._availableActions.next_category
                }
                : {
                    title: this._translator.translate("key-stat-next"),
                    key: "ArrowDown",
                    keyDescription: this._translator.translate("key-descr-ArrowDown"),
                    callback: this._availableActions.next_stat
                },
            this._type === "matrix"
                ? {
                    title: this._translator.translate("key-group-prev"),
                    key: "ArrowUp",
                    keyDescription: this._translator.translate("key-descr-ArrowUp"),
                    callback: this._availableActions.previous_category
                }
                : {
                    title: this._translator.translate("key-stat-prev"),
                    key: "ArrowUp",
                    keyDescription: this._translator.translate("key-descr-ArrowUp"),
                    callback: this._availableActions.previous_stat
                },
            !this._hierarchy && {
                title: this._translator.translate("key-group-next"),
                key: "PageDown",
                keyDescription: this._translator.translate("key-descr-PageDown"),
                description: this._translator.translate("key-descr-alt-PageDown"),
                callback: this._availableActions.next_category
            },
            !this._hierarchy && {
                title: this._translator.translate("key-group-prev"),
                key: "PageUp",
                keyDescription: this._translator.translate("key-descr-PageUp"),
                description: this._translator.translate("key-descr-alt-PageUp"),
                callback: this._availableActions.previous_category
            },
            this._hierarchy
                ? {
                    title: this._translator.translate("key-hier-root"),
                    key: "Alt+PageUp",
                    keyDescription: this._translator.translate("key-descr-Alt+PageUp"),
                    description: this._translator.translate("key-descr-alt-Alt+PageUp"),
                    callback: this._availableActions.go_to_root
                }
                : {
                    title: this._translator.translate("key-group-first"),
                    key: "Alt+PageUp",
                    keyDescription: this._translator.translate("key-descr-Alt+PageUp"),
                    description: this._translator.translate("key-descr-alt-Alt+PageUp"),
                    callback: this._availableActions.first_category
                },
            !this._hierarchy && {
                title: this._translator.translate("key-group-last"),
                key: "Alt+PageDown",
                keyDescription: this._translator.translate("key-descr-Alt+PageDown"),
                description: this._translator.translate("key-descr-alt-Alt+PageDown"),
                callback: this._availableActions.last_category
            },
            !this._hierarchy && {
                title: this._translator.translate("key-play-fwd-group"),
                key: "Shift+PageDown",
                keyDescription: this._translator.translate("key-descr-Shift+PageDown"),
                description: this._translator.translate("key-descr-alt-Shift+PageDown"),
                callback: this._availableActions.play_forward_category
            },
            !this._hierarchy && {
                title: this._translator.translate("key-play-back-group"),
                key: "Shift+PageUp",
                keyDescription: this._translator.translate("key-descr-Shift+PageUp"),
                description: this._translator.translate("key-descr-alt-Shift+PageUp"),
                callback: this._availableActions.play_backward_category
            },
            {
                title: this._translator.translate(`key-${this._hierarchy ? "level" : "group"}-min`),
                key: "[",
                callback: this._availableActions.go_minimum
            },
            {
                title: this._translator.translate(`key-${this._hierarchy ? "level" : "group"}-max`),
                key: "]",
                callback: this._availableActions.go_maximum
            },
            !this._hierarchy && {
                title: this._translator.translate("key-chart-min"),
                key: "Ctrl+[",
                keyDescription: this._translator.translate("key-descr-Ctrl+["),
                callback: this._availableActions.go_total_minimum
            },
            !this._hierarchy && {
                title: this._translator.translate("key-chart-max"),
                key: "Ctrl+]",
                keyDescription: this._translator.translate("key-descr-Ctrl+]"),
                callback: this._availableActions.go_total_maximum
            },
            this._hierarchy && {
                title: this._translator.translate("key-level-decr"),
                key: "Alt+ArrowDown",
                keyDescription: this._translator.translate("key-descr-Alt+ArrowDown"),
                callback: this._availableActions.drill_down
            },
            this._hierarchy && {
                title: this._translator.translate("key-level-incr"),
                key: "Alt+ArrowUp",
                keyDescription: this._translator.translate("key-descr-Alt+ArrowUp"),
                callback: this._availableActions.drill_up
            },
            {
                title: this._translator.translate("key-monitor-toggle"),
                caseSensitive: false,
                key: "m",
                keyDescription: "M",
                callback: this._availableActions.monitor
            },
            {
                title: this._translator.translate("key-dialog-help"),
                caseSensitive: false,
                key: "h",
                keyDescription: "H",
                callback: this._availableActions.help
            },
            {
                title: this._translator.translate("key-dialog-options"),
                caseSensitive: false,
                key: "o",
                keyDescription: "O",
                callback: this._availableActions.options
            }
        ].filter((item) => Boolean(item)));
        if (this._info.notes?.length > 0) {
            this._keyEventManager.registerKeyEvent({
                title: this._translator.translate("info-open"),
                caseSensitive: false,
                key: "i",
                callback: this._availableActions.info
            });
        }
        const hotkeyCallbackWrapper = (cb) => {
            cb({
                slice: this._currentGroupName,
                index: this._pointIndex,
                point: this.currentPoint
            });
        };
        this._options.customHotkeys?.forEach((hotkey) => {
            this._keyEventManager.registerKeyEvent({
                ...hotkey,
                key: keyboardEventToString(hotkey.key),
                callback: () => {
                    hotkeyCallbackWrapper(hotkey.callback);
                }
            });
        });
        this._cleanUpTasks.push(() => {
            this._keyEventManager.cleanup();
        });
    }
    _setHertzClamps(lowerIndex, upperIndex) {
        this._hertzClamps.lower = lowerIndex;
        this._hertzClamps.upper = upperIndex;
    }
    _initializeData(userData) {
        if (!Array.isArray(userData)) {
            this._groups = Object.keys(userData);
            this._visible_group_indices = this._groups.map((value, index) => index);
            this._data = Object.values(userData).map((row) => convertDataRow(row));
            return;
        }
        this._groups = [""];
        this._visible_group_indices = [0];
        this._data = [convertDataRow(userData)];
    }
    generateGroupSummary() {
        if (this._currentGroupType === "unsupported") {
            return this._translator.translate("group-unknown", {
                title: this._currentGroupName
            });
        }
        const code = ["chart", this._currentGroupType];
        if (this._currentGroupName.length > 0) {
            code.push("labeled");
        }
        const text = [
            this._translator.translate(code.join("-"), {
                label: this._currentGroupName
            }),
            generateAxisSummary({
                axisLetter: "x",
                axis: this._xAxis,
                translationCallback: (code, evaluators) => {
                    return this._translator.translate(code, evaluators);
                }
            }),
            isAlternateAxisDataPoint(this.currentPoint)
                ? generateAxisSummary({
                    axisLetter: "y2",
                    axis: this._y2Axis,
                    translationCallback: (code, evaluators) => {
                        return this._translator.translate(code, evaluators);
                    }
                })
                : generateAxisSummary({
                    axisLetter: "y",
                    axis: this._yAxis,
                    translationCallback: (code, evaluators) => {
                        return this._translator.translate(code, evaluators);
                    }
                })
        ];
        return text.join(" ");
    }
    _startListening() {
        const focusEvent = () => {
            this._sr.clear();
            if (this._options.live) {
                this._generateSummary();
            }
            if (this._options.enableSpeech) {
                this._sr.render(this._chartSummary +
                    " " +
                    this.generateGroupSummary() +
                    " " +
                    this._instructions);
            }
            if (window.__chart2music_options__?._hertzClamps) {
                const { lower, upper } = window.__chart2music_options__._hertzClamps;
                this._setHertzClamps(lower, upper);
            }
            this._onFocus();
        };
        const blurEvent = () => {
            this._monitorMode = false;
        };
        this._chartElement.addEventListener("focus", focusEvent);
        this._chartElement.addEventListener("blur", blurEvent);
        this._cleanUpTasks.push(() => {
            this._chartElement.removeEventListener("focus", focusEvent);
            this._chartElement.removeEventListener("blur", blurEvent);
        });
    }
    _announceCategoryChange() {
        if (this._silent) {
            return;
        }
        this._sr.render(this.generateGroupSummary());
    }
    _playAndSpeak() {
        if (this._silent) {
            return;
        }
        this._playCurrent();
        setTimeout(() => {
            this._speakCurrent(this.currentPoint);
        }, NOTE_LENGTH * 1000);
    }
    _moveNextOutlier() {
        if (isBoxDataPoint(this.currentPoint) &&
            "outlier" in this.currentPoint) {
            const { outlier } = this.currentPoint;
            if (this._outlierIndex >= outlier.length - 1) {
                return false;
            }
            this._outlierIndex++;
            return true;
        }
        return false;
    }
    _movePrevOutlier() {
        if (isBoxDataPoint(this.currentPoint) &&
            "outlier" in this.currentPoint) {
            if (this._outlierIndex <= 0) {
                this._outlierIndex = 0;
                return false;
            }
            this._outlierIndex--;
            return true;
        }
        return false;
    }
    _moveRight() {
        if (this._outlierMode) {
            return this._moveNextOutlier();
        }
        const max = this._currentDataRow.length - 1;
        if (this._pointIndex >= max) {
            this._pointIndex = max;
            return false;
        }
        this._pointIndex++;
        return true;
    }
    _moveLeft() {
        if (this._outlierMode) {
            return this._movePrevOutlier();
        }
        if (this._pointIndex <= 0) {
            this._pointIndex = 0;
            return false;
        }
        this._pointIndex--;
        return true;
    }
    _moveToMinimum() {
        const index = this._metadataByGroup[this._groupIndex].minimumPointIndex;
        if (index === -1) {
            return false;
        }
        this._pointIndex = index;
        return true;
    }
    _moveToMaximum() {
        const index = this._metadataByGroup[this._groupIndex].maximumPointIndex;
        if (index === -1) {
            return false;
        }
        this._pointIndex = index;
        return true;
    }
    _moveLeftTenths() {
        const current = this.currentPoint;
        if (this._outlierMode &&
            isBoxDataPoint(current) &&
            "outlier" in current) {
            if (this._outlierIndex <= 0) {
                this._outlierIndex = 0;
                return false;
            }
            const tenths = Math.round(current.outlier.length / 10);
            this._outlierIndex = Math.max(this._outlierIndex - tenths, 0);
            return true;
        }
        if (this._pointIndex === 0) {
            return false;
        }
        this._pointIndex = Math.max(this._pointIndex - this._metadataByGroup[this._groupIndex].tenths, 0);
        return true;
    }
    _moveRightTenths() {
        const current = this.currentPoint;
        if (this._outlierMode &&
            isBoxDataPoint(current) &&
            "outlier" in current) {
            if (this._outlierIndex >= current.outlier.length - 1) {
                this._outlierIndex = current.outlier.length - 1;
                return false;
            }
            const tenths = Math.round(current.outlier.length / 10);
            this._outlierIndex = Math.min(this._outlierIndex + tenths, current.outlier.length - 1);
            return true;
        }
        if (this._pointIndex === this._currentDataRow.length - 1) {
            return false;
        }
        this._pointIndex = Math.min(this._pointIndex + this._metadataByGroup[this._groupIndex].tenths, this._data[this._groupIndex].length - 1);
        return true;
    }
    _checkOutlierMode() {
        const { statIndex, availableStats } = this._metadataByGroup[this._groupIndex];
        this._outlierMode = ["outlier", "xtremeOutlier"].includes(availableStats[statIndex]);
        this._outlierIndex = 0;
    }
    _movePrevStat() {
        const { statIndex } = this._metadataByGroup[this._groupIndex];
        if (statIndex < 0) {
            return false;
        }
        this._metadataByGroup[this._groupIndex].statIndex = statIndex - 1;
        this._checkOutlierMode();
        return true;
    }
    _moveNextStat() {
        const { statIndex, availableStats } = this._metadataByGroup[this._groupIndex];
        if (statIndex >= availableStats.length - 1) {
            return false;
        }
        this._metadataByGroup[this._groupIndex].statIndex = statIndex + 1;
        const newStat = availableStats[this._metadataByGroup[this._groupIndex].statIndex];
        const current = this._data[this._groupIndex][this._pointIndex];
        if (newStat === "outlier" &&
            !("outlier" in current &&
                Array.isArray(current.outlier) &&
                current.outlier.length > 0)) {
            this._metadataByGroup[this._groupIndex].statIndex--;
            return false;
        }
        this._checkOutlierMode();
        return true;
    }
    _playLeftOutlier() {
        const min = 0;
        this._playListInterval = setInterval(() => {
            if (this._outlierIndex <= min) {
                this._outlierIndex = min;
                this._clearPlay();
            }
            else {
                this._outlierIndex--;
                this._playCurrent();
            }
        }, SPEEDS.at(this._speedRateIndex));
        this._playCurrent();
    }
    _playLeft() {
        if (this._outlierMode) {
            this._playLeftOutlier();
            return;
        }
        if (this._xAxis.continuous) {
            this._playLeftContinuous();
            return;
        }
        const min = 0;
        this._playListInterval = setInterval(() => {
            if (this._pointIndex <= min) {
                this._pointIndex = min;
                this._clearPlay();
            }
            else {
                this._pointIndex--;
                this._playCurrent();
            }
        }, SPEEDS.at(this._speedRateIndex));
        this._playCurrent();
    }
    _playRightOutlier() {
        if (!(isBoxDataPoint(this.currentPoint) &&
            "outlier" in this.currentPoint)) {
            return;
        }
        const max = this.currentPoint.outlier?.length - 1;
        this._playListInterval = setInterval(() => {
            if (this._outlierIndex >= max) {
                this._outlierIndex = max;
                this._clearPlay();
            }
            else {
                this._outlierIndex++;
                this._playCurrent();
            }
        }, SPEEDS.at(this._speedRateIndex));
        this._playCurrent();
    }
    _playRightContinuous() {
        const startIndex = this._pointIndex;
        const startX = this.getCurrent().point.x;
        const row = this._currentDataRow.slice(startIndex);
        const totalTime = SPEEDS.at(this._speedRateIndex) * 10;
        const xMin = this._xAxis.minimum;
        const range = this._xAxis.maximum - xMin;
        const change = this._xAxis.type === "linear"
            ? (x) => {
                return (x - xMin) / range;
            }
            : (x) => {
                return ((Math.log10(x) - Math.log10(xMin)) / Math.log10(range));
            };
        const startingPct = change(startX);
        row.forEach((item, index) => {
            this._playListContinuous.push(setTimeout(() => {
                this._pointIndex = startIndex + index;
                this._playCurrent();
            }, (change(item.x) - startingPct) * totalTime));
        });
    }
    _playLeftContinuous() {
        const startIndex = this._pointIndex;
        const startX = this.getCurrent().point.x;
        const row = this._currentDataRow.slice(0, startIndex + 1);
        const totalTime = SPEEDS.at(this._speedRateIndex) * 10;
        const xMin = this._xAxis.minimum;
        const range = this._xAxis.maximum - xMin;
        const change = this._xAxis.type === "linear"
            ? (x) => {
                return 1 - (x - xMin) / range;
            }
            : (x) => {
                return (1 -
                    (Math.log10(x) - Math.log10(xMin)) / Math.log10(range));
            };
        const startingPct = change(startX);
        row.reverse().forEach((item, index) => {
            this._playListContinuous.push(setTimeout(() => {
                this._pointIndex = startIndex - index;
                this._playCurrent();
            }, (change(item.x) - startingPct) * totalTime));
        });
    }
    _playRight() {
        if (this._outlierMode) {
            this._playRightOutlier();
            return;
        }
        if (this._xAxis.continuous) {
            this._playRightContinuous();
            return;
        }
        const max = this._currentDataRow.length - 1;
        this._playListInterval = setInterval(() => {
            if (this._pointIndex >= max) {
                this._pointIndex = max;
                this._clearPlay();
            }
            else {
                this._pointIndex++;
                this._playCurrent();
            }
        }, SPEEDS.at(this._speedRateIndex));
        this._playCurrent();
    }
    _updateToNewLevel(groupIndex, pointIndex = 0) {
        this._visibleGroupIndex = groupIndex;
        this._pointIndex = pointIndex;
        this._flagNewLevel = true;
        this._xAxis = initializeAxis({
            data: this._data,
            axisName: "x",
            userAxis: this._explicitAxes.x,
            filterGroupIndex: this._visibleGroupIndex
        });
        this._yAxis = initializeAxis({
            data: this._data,
            axisName: "y",
            userAxis: {
                ...this._explicitAxes.y,
                minimum: 0
            },
            filterGroupIndex: this._visibleGroupIndex
        });
        this._generateSummary();
    }
    _drillDown() {
        const { children } = this.currentPoint;
        if (!children) {
            return false;
        }
        const groupIndex = this._groups.indexOf(children);
        this._hierarchyBreadcrumbs.push({
            groupIndex: this._visibleGroupIndex,
            pointIndex: this._pointIndex
        });
        this._updateToNewLevel(groupIndex);
        return true;
    }
    _drillUp() {
        if (this._hierarchyBreadcrumbs.length === 0) {
            return false;
        }
        const { groupIndex, pointIndex } = this._hierarchyBreadcrumbs.pop();
        this._updateToNewLevel(groupIndex, pointIndex);
        return true;
    }
    _drillToRoot() {
        if (this._hierarchyBreadcrumbs.length === 0) {
            return false;
        }
        const { groupIndex, pointIndex } = this._hierarchyBreadcrumbs[0];
        this._updateToNewLevel(groupIndex, pointIndex);
        this._hierarchyBreadcrumbs = [];
        return true;
    }
    _getHertzRange() {
        return this._options.hertzes.slice(this._hertzClamps.lower, this._hertzClamps.upper);
    }
    _playCurrent() {
        if (!this._options.enableSound) {
            this._onFocus();
            return;
        }
        const { statIndex, availableStats } = this._metadataByGroup[this._groupIndex];
        this._playDataPoint(this.currentPoint, statIndex, availableStats);
        this._onFocus();
    }
    _checkAudioEngine() {
        if (!context) {
            context = new AudioContext();
        }
        if (!this._audioEngine && context) {
            this._audioEngine =
                this._providedAudioEngine ?? new OscillatorAudioEngine(context);
        }
    }
    _playDataPoint(current, statIndex, availableStats) {
        this._checkAudioEngine();
        if (!this._audioEngine) {
            return;
        }
        if (isUnplayable(current.x, this._xAxis)) {
            return;
        }
        const hertzes = this._getHertzRange();
        const xPan = this._xAxis.type === "log10"
            ? calcPan((Math.log10(current.x) -
                Math.log10(this._xAxis.minimum)) /
                (Math.log10(this._xAxis.maximum) -
                    Math.log10(this._xAxis.minimum)))
            : calcPan((current.x - this._xAxis.minimum) /
                (this._xAxis.maximum - this._xAxis.minimum));
        if (current.type === "annotation") {
            this._audioEngine.playNotification(AudioNotificationType.Annotation, xPan);
            return;
        }
        if (isSimpleDataPoint(current)) {
            if (isUnplayable(current.y, this._yAxis)) {
                return;
            }
            const yBin = interpolateBin({
                point: current.y,
                min: this._yAxis.minimum,
                max: this._yAxis.maximum,
                bins: hertzes.length - 1,
                scale: this._yAxis.type
            });
            this._audioEngine.playDataPoint(hertzes[yBin], xPan, NOTE_LENGTH);
            return;
        }
        if (isAlternateAxisDataPoint(current)) {
            if (isUnplayable(current.y2, this._y2Axis)) {
                return;
            }
            const yBin = interpolateBin({
                point: current.y2,
                min: this._y2Axis.minimum,
                max: this._y2Axis.maximum,
                bins: hertzes.length - 1,
                scale: this._y2Axis.type
            });
            this._audioEngine.playDataPoint(hertzes[yBin], xPan, NOTE_LENGTH);
            return;
        }
        if (isBoxDataPoint(current) &&
            this._outlierMode &&
            "outlier" in current) {
            const yBin = interpolateBin({
                point: current.outlier[this._outlierIndex],
                min: this._yAxis.minimum,
                max: this._yAxis.maximum,
                bins: hertzes.length - 1,
                scale: this._yAxis.type
            });
            this._audioEngine.playDataPoint(hertzes[yBin], xPan, NOTE_LENGTH);
            return;
        }
        if (isOHLCDataPoint(current) || isHighLowDataPoint(current)) {
            if (statIndex >= 0) {
                const stat = availableStats[statIndex];
                if (isUnplayable(current[stat], this._yAxis)) {
                    return;
                }
                const yBin = interpolateBin({
                    point: current[stat],
                    min: this._yAxis.minimum,
                    max: this._yAxis.maximum,
                    bins: hertzes.length - 1,
                    scale: this._yAxis.type
                });
                this._audioEngine.playDataPoint(hertzes[yBin], xPan, NOTE_LENGTH);
                return;
            }
            const interval = 1 / (availableStats.length + 1);
            availableStats.forEach((stat, index) => {
                if (isUnplayable(current[stat], this._yAxis) ||
                    stat === "outlier") {
                    return;
                }
                const yBin = interpolateBin({
                    point: current[stat],
                    min: this._yAxis.minimum,
                    max: this._yAxis.maximum,
                    bins: hertzes.length - 1,
                    scale: this._yAxis.type
                });
                setTimeout(() => {
                    this._audioEngine.playDataPoint(hertzes[yBin], xPan, NOTE_LENGTH);
                }, SPEEDS.at(this._speedRateIndex) * interval * index);
            });
        }
    }
    _onFocus() {
        if (this.currentPoint?.type === "annotation") {
            return;
        }
        this._options?.onFocusCallback?.({
            slice: this._currentGroupName,
            index: this._pointIndex,
            point: this.currentPoint
        });
    }
    _speakCurrent(current) {
        if (!this._options.enableSpeech) {
            return;
        }
        if (current.type === "annotation") {
            this._sr.render(current.label);
            return;
        }
        const { statIndex, availableStats } = this._metadataByGroup.at(this._groupIndex);
        if (this._flagNewStat && availableStats.length === 0) {
            this._flagNewStat = false;
        }
        const point = generatePointDescription({
            translationCallback: (code, evaluators) => {
                return this._translator.translate(code, evaluators);
            },
            point: current,
            xFormat: formatWrapper({
                axis: this._xAxis,
                translationCallback: (code, evaluators) => {
                    return this._translator.translate(code, evaluators);
                }
            }),
            yFormat: formatWrapper({
                translationCallback: (code, evaluators) => {
                    return this._translator.translate(code, evaluators);
                },
                axis: isAlternateAxisDataPoint(current)
                    ? this._y2Axis
                    : this._yAxis
            }),
            stat: availableStats[statIndex],
            outlierIndex: this._outlierMode ? this._outlierIndex : null,
            announcePointLabelFirst: this._announcePointLabelFirst
        });
        const text = filteredJoin([
            this._flagNewLevel && this._currentGroupName,
            this._flagNewStat &&
                this._translator.translate(`stat-${availableStats[statIndex] ?? "all"}`),
            point,
            this._hierarchy &&
                current.children &&
                this._translator.translate("nodeHasChildren")
        ], ", ");
        this._sr.render(text);
        this._flagNewLevel = false;
        this._flagNewStat = false;
    }
}

export { c2m, c2mChart, c2mChart as default };
