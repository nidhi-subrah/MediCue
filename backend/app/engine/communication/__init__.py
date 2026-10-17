"""MediCue Adaptive Communication Engine (docs/ADAPTIVE_COMMUNICATION.md).

    signals.py   layer 1, Signal Detection: what happened while the patient was answering
    policy.py    layer 2, Adaptation Policy: should the way we ask change, and how little can we change
    (layer 3, the Interface Renderer, is the bedside tablet: frontend/components/talk)

The decision engine (engine/decision.py) still decides WHAT to ask; this decides HOW. Neither layer reads the
clock, calls a network or touches the belief.
"""
