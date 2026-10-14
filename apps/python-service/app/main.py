from fastapi import FastAPI

app = FastAPI(title="Caliu python-service")


@app.get("/health")
def health():
    return {"status": "ok", "service": "python-service"}
