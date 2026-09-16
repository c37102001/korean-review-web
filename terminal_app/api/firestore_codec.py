from typing import Any, Dict


def document_id(document_name: str) -> str:
    return document_name.rsplit("/", 1)[-1] if document_name else ""


def parse_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    return {key: parse_value(value) for key, value in fields.items()}


def parse_value(value: Dict[str, Any]) -> Any:
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [parse_value(item) for item in value.get("arrayValue", {}).get("values", [])]
    if "mapValue" in value:
        return parse_fields(value.get("mapValue", {}).get("fields", {}))
    return None


def to_value(value: Any) -> Dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [to_value(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {key: to_value(item) for key, item in value.items()}}}
    return {"stringValue": str(value)}
