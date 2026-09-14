from typing import Optional

from pydantic import BaseModel


class Vitals(BaseModel):
    temp_c: Optional[float] = None
    pulse_bpm: Optional[float] = None
    breathing_rpm: Optional[float] = None


class PredictRequest(BaseModel):
    symptoms: list[str]
    age_years: float
    sex: str  # "M", "F", or "O"
    risk_factors: dict[str, bool] = {}
    vitals: Vitals = Vitals()
    lang: str = "en"


class DifferentialEntry(BaseModel):
    disease: str
    probability: float
    confidence_band: str


class ExplanationEntry(BaseModel):
    symptom: str
    contribution: float


class WhyNotOtherEntry(BaseModel):
    disease: str
    reason: Optional[str] = None


class PredictResponse(BaseModel):
    tier: str
    tier_source: str  # "red_flag" or "model"
    rule_id: Optional[str] = None
    rationale: Optional[str] = None
    action: Optional[str] = None
    differential: list[DifferentialEntry] = []
    explanation: list[ExplanationEntry] = []
    why_not_others: list[WhyNotOtherEntry] = []
    disclaimer: str


class HealthResponse(BaseModel):
    status: str
    n_diseases: int
    model_version: str
