"""Voice input: the free local matcher, and what an urgent phrase does. No microphone or Gemini involved -
these run on transcripts, exactly as the browser's own speech recognition would hand them to the API."""
import pytest
from fastapi.testclient import TestClient

from app.engine.voice_match import detect_urgent, match_option
from app.main import app

from tests.conftest import login_as_nurse, login_as_patient

AREAS = [{"id": "head", "label": "Head"}, {"id": "belly", "label": "Belly"},
         {"id": "mouth_throat", "label": "Face"}, {"id": "toilet", "label": "Washroom"}]
BELLY = [{"id": "belly.hurts", "label": "Hurts", "concept": "pain"},
         {"id": "belly.sick", "label": "Feel sick", "concept": "sick"},
         {"id": "belly.washroom", "label": "Need the washroom", "concept": "need_toilet"},
         {"id": "belly.none", "label": "None of these", "concept": None}]


@pytest.mark.parametrize("phrase", ["this is an emergency", "it is urgent", "I can't breathe", "call 911", "I am bleeding"])
def test_urgency_words_are_detected(phrase):
    assert detect_urgent(phrase)


@pytest.mark.parametrize("phrase", ["my head hurts", "can somebody help me get up", "I am scared", "I am studying"])
def test_ordinary_words_are_not_urgent(phrase):
    assert not detect_urgent(phrase)


def test_matcher_picks_the_area_and_option_from_natural_sentences():
    assert match_option("my head really hurts", AREAS) == ("head", "clear")
    assert match_option("my eyes hurt", AREAS) == ("mouth_throat", "clear")
    assert match_option("none of them", BELLY) == ("belly.none", "clear")
    assert match_option("I feel like throwing up", BELLY) == ("belly.sick", "clear")


def test_matcher_infers_the_related_option_when_the_named_one_is_not_offered():
    assert match_option("I need medicine", BELLY) == ("belly.hurts", "clear")   # no medicine choice at the belly


def test_matcher_does_not_guess_from_filler_or_nonsense():
    assert match_option("I need something", BELLY)[0] is None
    assert match_option("blah mumble", AREAS)[0] is None


def _patient_session(client):
    login_as_patient(client)
    r = client.post("/api/sessions", json={"patient_id": "p-chen", "mode": "grid"})
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


def test_an_urgent_phrase_alerts_the_nurse_with_the_patients_own_words():
    with TestClient(app) as client:
        sid = _patient_session(client)
        r = client.post(f"/api/sessions/{sid}/voice", json={"transcript": "this is an emergency"})
        assert r.status_code == 200
        body = r.json()
        assert body["outcome"] == "urgent" and body["session"]["status"] == "escalated"

        client.cookies.clear()
        login_as_nurse(client)
        alert = next(a for a in client.get("/api/alerts").json() if a["session_id"] == sid)
        assert alert["priority"] == "urgent" and alert["voice_transcripts"] == ["this is an emergency"]


def test_an_ordinary_phrase_does_not_alert_anyone():
    with TestClient(app) as client:
        sid = _patient_session(client)
        body = client.post(f"/api/sessions/{sid}/voice", json={"transcript": "my head really hurts"}).json()
        assert body["outcome"] == "suggested" and body["session"]["status"] == "area"
        assert body["session"]["alert_id"] is None
