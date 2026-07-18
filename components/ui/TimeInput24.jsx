"use client";

import { forwardRef } from "react";

import { isValidTime24 } from "@/lib/datetime/ecuador";

const TIME_PATTERN = "(?:(?:[01]\\d|2[0-3]):[0-5]\\d|24:00)";

function isTimeDraftWithinRange(hours, minutes) {
  if (hours.length === 2 && Number(hours) > 24) return false;
  if (minutes.length === 2 && Number(minutes) > 59) return false;
  if (hours === "24" && minutes && !/^0{1,2}$/.test(minutes)) return false;

  return true;
}

function sanitizeTimeDraft(value, previousValue = "") {
  const source = String(value || "").replace(/[^\d:]/g, "");
  let hours = "";
  let minutes = "";
  let nextValue = "";

  if (source.includes(":")) {
    const [hourPart = "", ...minuteParts] = source.split(":");
    hours = hourPart.slice(0, 2);
    minutes = minuteParts.join("").slice(0, 2);
    nextValue = `${hours}:${minutes}`;
  } else {
    const digits = source.slice(0, 4);
    hours = digits.slice(0, 2);
    minutes = digits.slice(2);
    nextValue = digits.length > 2 ? `${hours}:${minutes}` : digits;
  }

  return isTimeDraftWithinRange(hours, minutes) ? nextValue : String(previousValue || "");
}

export function normalizeTime24(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{1,2})$/);

  if (!match) return "";

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  const normalizedValue = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return isValidTime24(normalizedValue) ? normalizedValue : "";
}

const TimeInput24 = forwardRef(function TimeInput24(
  {
    value = "",
    onChange,
    onBlur,
    placeholder = "HH:mm",
    title = "Formato de 24 horas: HH:mm",
    ...props
  },
  ref,
) {
  function handleChange(event) {
    const nextValue = sanitizeTimeDraft(event.currentTarget.value, value);

    event.currentTarget.value = nextValue;
    event.currentTarget.setCustomValidity("");
    onChange?.(event);
  }

  function handleBlur(event) {
    const normalizedValue = normalizeTime24(event.currentTarget.value);

    if (event.currentTarget.value && !normalizedValue) {
      event.currentTarget.setCustomValidity("Ingresa una hora válida entre 00:00 y 24:00.");
    } else {
      event.currentTarget.setCustomValidity("");

      if (normalizedValue && normalizedValue !== event.currentTarget.value) {
        event.currentTarget.value = normalizedValue;
        onChange?.(event);
      }
    }

    onBlur?.(event);
  }

  return (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      pattern={TIME_PATTERN}
      placeholder={placeholder}
      title={title}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
});

export default TimeInput24;
