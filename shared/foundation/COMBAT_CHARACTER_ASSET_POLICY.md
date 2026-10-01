# Combat character asset policy

- Standing artwork is restricted to story, character introduction, and shelter progression/equipment/skill UI.
- Every combat player sprite must be rear or rear-oblique, seated/crouched, and connected to cover/reload animation.
- Combat aim spans 9 o'clock to 3 o'clock with time-based interpolation over a 64-slot logical clip.
- Pointer/touch targeting controls the selected character's aim pose, muzzle origin, and projectile vector together.
- A combat registry reference to `STAND_*`, a standing fire pack, or a silent standing fallback is a release-blocking error.

