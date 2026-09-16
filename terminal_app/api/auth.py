from terminal_app.domain.models import AuthSession


class FirebaseAuthService:
    def __init__(self, api_key: str, transport) -> None:
        self.api_key = api_key
        self.transport = transport

    def sign_in(self, email: str, password: str) -> AuthSession:
        data = self.transport.request_json(
            "POST",
            f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={self.api_key}",
            payload={"email": email, "password": password, "returnSecureToken": True},
        )
        return AuthSession(
            email=data.get("email", email),
            uid=data["localId"],
            id_token=data["idToken"],
            refresh_token=data["refreshToken"],
        )

    def refresh(self, session: AuthSession) -> str:
        data = self.transport.request_json(
            "POST",
            f"https://securetoken.googleapis.com/v1/token?key={self.api_key}",
            payload={"grant_type": "refresh_token", "refresh_token": session.refresh_token},
            allow_retry=False,
        )
        session.id_token = data.get("id_token", session.id_token)
        session.refresh_token = data.get("refresh_token", session.refresh_token)
        return session.id_token
