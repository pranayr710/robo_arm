"""
morse.py — pure Morse-code logic (no hardware, no camera; fully unit-testable).

Used by blink_morse.py: eye blinks are turned into dots/dashes, accumulated
into letters/words here, and the decoded text is what the arm writes.
"""

MORSE = {
    "A": ".-",    "B": "-...",  "C": "-.-.",  "D": "-..",   "E": ".",
    "F": "..-.",  "G": "--.",   "H": "....",  "I": "..",    "J": ".---",
    "K": "-.-",   "L": ".-..",  "M": "--",    "N": "-.",    "O": "---",
    "P": ".--.",  "Q": "--.-",  "R": ".-.",   "S": "...",   "T": "-",
    "U": "..-",   "V": "...-",  "W": ".--",   "X": "-..-",  "Y": "-.--",
    "Z": "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
}
_REV = {v: k for k, v in MORSE.items()}


def encode(text):
    """'SOS OK' -> '... --- ...   -.- ...' (letters by space, words by '   ')."""
    words = text.upper().split()
    return "   ".join(" ".join(MORSE[c] for c in w if c in MORSE) for w in words)


def decode(code):
    """Inverse of encode(). Unknown symbols become '?'."""
    words = code.strip().split("   ")
    out = []
    for w in words:
        out.append("".join(_REV.get(sym, "?") for sym in w.split()))
    return " ".join(out)


class MorseAccumulator:
    """Builds decoded text incrementally from blink-derived symbols.

    Feed dots/dashes with add('.') / add('-'); call end_letter() on a letter
    gap and end_word() on a word gap. .text holds the running message and
    .pending shows the symbols collected for the current (unfinished) letter.
    """

    def __init__(self):
        self.text = ""
        self.pending = ""

    def add(self, symbol):
        if symbol in (".", "-"):
            self.pending += symbol

    def end_letter(self):
        if self.pending:
            self.text += _REV.get(self.pending, "?")
            self.pending = ""

    def end_word(self):
        self.end_letter()
        if self.text and not self.text.endswith(" "):
            self.text += " "

    def reset(self):
        self.text = ""
        self.pending = ""


if __name__ == "__main__":
    # quick self-test
    assert encode("SOS") == "... --- ..."
    assert decode("... --- ...") == "SOS"
    assert decode(encode("HELLO WORLD")) == "HELLO WORLD"
    acc = MorseAccumulator()
    for s in "...":
        acc.add(s)
    acc.end_letter(); acc.end_word()
    for s in "---":
        acc.add(s)
    acc.end_letter()
    assert acc.text == "S O", acc.text
    print("morse.py self-test OK")
