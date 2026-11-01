"""Run against: firebase emulators:start --only firestore --project demo-mountain."""
import base64
import json
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

URL = "http://127.0.0.1:8080/v1/projects/demo-mountain/databases/(default)/documents/impostazioni/sezioni"
PLACES_URL = URL.replace("/sezioni", "/luoghi")
DEFAULTS = {key: {"booleanValue": True} for key in ("home", "previsione", "mappa", "specie", "webcam", "meteo")}


def token(email, verified=True):
    def enc(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    now = int(time.time())
    claims = {"iss": "https://securetoken.google.com/demo-mountain", "aud": "demo-mountain",
              "sub": email.split("@")[0], "user_id": email.split("@")[0], "email": email,
              "email_verified": verified, "iat": now, "exp": now + 3600,
              "auth_time": now, "firebase": {"sign_in_provider": "google.com"}}
    return enc({"alg": "none", "typ": "JWT"}) + "." + enc(claims) + "."


def request(method, email=None, fields=None, verified=True, url=URL):
    headers = {"Content-Type": "application/json"}
    if email:
        headers["Authorization"] = "Bearer " + token(email, verified)
    body = json.dumps({"fields": fields}).encode() if fields is not None else None
    try:
        with urlopen(Request(url, data=body, headers=headers, method=method), timeout=10) as res:
            return res.status
    except HTTPError as exc:
        return exc.code


class SectionRulesTests(unittest.TestCase):
    def test_permissions_and_validation(self):
        self.assertEqual(request("PATCH", "eug2002@gmail.com", DEFAULTS), 200)
        self.assertEqual(request("GET", "visitor@example.test"), 200)
        self.assertEqual(request("GET"), 403)
        self.assertEqual(request("PATCH", "visitor@example.test", DEFAULTS), 403)
        self.assertEqual(request("PATCH", "eug2002@gmail.com", DEFAULTS, verified=False), 403)
        self.assertEqual(request("PATCH", "eug2002@gmail.com", {**DEFAULTS, "specie": {"stringValue": "false"}}), 403)
        self.assertEqual(request("PATCH", "eug2002@gmail.com", {**DEFAULTS, "extra": {"booleanValue": True}}), 403)
        self.assertEqual(request("DELETE", "visitor@example.test"), 403)
        self.assertEqual(request("PATCH", "eug2002@gmail.com", {**DEFAULTS, "specie": {"booleanValue": False}}), 200)

    def test_place_permissions(self):
        fields = {key: {"booleanValue": True} for key in
                  ("livata", "campaegli", "roccacanterano", "canterano", "cicchetti", "subiaco", "jenne")}
        self.assertEqual(request("PATCH", "eug2002@gmail.com", fields, url=PLACES_URL), 200)
        self.assertEqual(request("GET", "visitor@example.test", url=PLACES_URL), 200)
        self.assertEqual(request("PATCH", "visitor@example.test", fields, url=PLACES_URL), 403)
        self.assertEqual(request("PATCH", "eug2002@gmail.com", fields, verified=False, url=PLACES_URL), 403)
        self.assertEqual(request("PATCH", "eug2002@gmail.com",
                                 {key: {"booleanValue": False} for key in fields}, url=PLACES_URL), 403)


if __name__ == "__main__":
    unittest.main()
