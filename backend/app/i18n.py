"""Short fixed texts the backend writes in the student's language (feedback and fallback templates)."""

LANGUAGE_LABELS = {"en": "English", "hi": "हिन्दी", "kn": "ಕನ್ನಡ"}

FEEDBACK = {
    "en": {
        "correct": "Correct! Well done.",
        "wrong": "Not quite: you {label}. The answer is {answer}.",
        "slip": "Nearly! Right method, but a small calculation slip. The answer is {answer}.",
        "unknown": "Not quite. The answer is {answer}.",
        "unanswered": "No answer yet. Finish this sum and write the answer.",
    },
    "hi": {
        "correct": "सही! बहुत बढ़िया।",
        "wrong": "थोड़ी चूक — {label}। सही उत्तर {answer} है।",
        "slip": "लगभग सही! तरीका सही है, बस हिसाब में छोटी गलती हुई। सही उत्तर {answer} है।",
        "unknown": "थोड़ी चूक। सही उत्तर {answer} है।",
        "unanswered": "अभी उत्तर नहीं लिखा। यह सवाल पूरा करो और उत्तर लिखो।",
    },
    "kn": {
        "correct": "ಸರಿ! ಚೆನ್ನಾಗಿದೆ.",
        "wrong": "ಸ್ವಲ್ಪ ತಪ್ಪಾಗಿದೆ — {label}. ಸರಿಯಾದ ಉತ್ತರ {answer}.",
        "slip": "ಬಹುತೇಕ ಸರಿ! ವಿಧಾನ ಸರಿ, ಲೆಕ್ಕದಲ್ಲಿ ಸಣ್ಣ ತಪ್ಪಾಗಿದೆ. ಸರಿಯಾದ ಉತ್ತರ {answer}.",
        "unknown": "ಸ್ವಲ್ಪ ತಪ್ಪಾಗಿದೆ. ಸರಿಯಾದ ಉತ್ತರ {answer}.",
        "unanswered": "ಇನ್ನೂ ಉತ್ತರ ಬರೆದಿಲ್ಲ. ಈ ಲೆಕ್ಕ ಮುಗಿಸಿ ಉತ್ತರ ಬರೆಯಿರಿ.",
    },
}

PARENT_TEMPLATE = {
    "en": "Hello! Today {name} practised {concept} in maths class. One thing to practise at home: {focus}. "
    "For example: {example} The teacher will follow up in class.",
    "hi": "नमस्ते! आज {name} ने गणित में {concept} का अभ्यास किया। घर पर इसका अभ्यास कराएँ: {focus}। "
    "उदाहरण: {example} शिक्षक कक्षा में इस पर फिर से काम करेंगे।",
    "kn": "ನಮಸ್ಕಾರ! ಇಂದು {name} ಗಣಿತದಲ್ಲಿ {concept} ಅಭ್ಯಾಸ ಮಾಡಿದರು. ಮನೆಯಲ್ಲಿ ಇದನ್ನು ಅಭ್ಯಾಸ ಮಾಡಿಸಿ: {focus}. "
    "ಉದಾಹರಣೆ: {example} ಶಿಕ್ಷಕರು ತರಗತಿಯಲ್ಲಿ ಇದನ್ನು ಮುಂದುವರಿಸುತ್ತಾರೆ.",
}


def feedback(language: str, correct: bool, tag: str | None, label: str | None, answer: str) -> str:
    texts = FEEDBACK.get(language, FEEDBACK["en"])
    if correct:
        return texts["correct"]
    if tag == "careless_arithmetic":
        return texts["slip"].format(answer=answer)
    if not tag or tag == "unclassified" or not label:
        return texts["unknown"].format(answer=answer)
    return texts["wrong"].format(label=label, answer=answer)
