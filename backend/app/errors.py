class ApiError(Exception):
    """Returned to the client as {"error": {"code", "message"}} with the given HTTP status."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
