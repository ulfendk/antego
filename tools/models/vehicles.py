"""
Toy vehicles for the easter eggs, sculpted with the same signed-distance tools as the soldiers
(see build.py): a Willys-style jeep with separate wheels (so they can spin) and a Sherman-style
tank with a separate turret (so it can swivel). Blender axes as for the figures: -Y is forward.

Where the parts go in the game (glTF axes, y up, +z forward) is listed in PARTS and must match
packages/client/src/scene/eggs.ts.
"""
import math

from mathutils import Matrix, Vector as V

WHEEL_R = 0.2
JEEP_WHEELS = [(sx * 0.4, sy * 0.55) for sy in (-1, 1) for sx in (-1, 1)]
TURRET_AT = (0.0, -0.05, 0.5)

PARTS = {
    "jeep-wheel": [[x, WHEEL_R, -y] for x, y in JEEP_WHEELS],
    "tank-turret": [[TURRET_AT[0], TURRET_AT[2], -TURRET_AT[1]]],
}


def rx(a):
    return Matrix.Rotation(a, 3, "X")


def plane(normal, up=(0, 0, 1)):
    """Rotation with local +z along `normal` and local +y as close to `up` as possible."""
    z = V(normal).normalized()
    x = V(up).cross(z).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


# ---------------------------------------------------------------- jeep

def jeep(B, s):
    panel, hard = B.Layer(s, 0.006), B.Layer(s, B.HARD)

    # Tub, scuttle and hood.
    panel.box((0, 0.28, 0.36), (0.74, 0.96, 0.24), bevel=0.03)
    panel.box((0, -0.25, 0.37), (0.68, 0.16, 0.26), bevel=0.025)
    panel.box((0, -0.58, 0.42), (0.58, 0.58, 0.12), bevel=0.03)
    panel.box((0, -0.58, 0.3), (0.55, 0.56, 0.18), bevel=0.02)
    # Hollow the tub, and cut arches for the rear wheels.
    hard.box((0, 0.3, 0.54), (0.64, 0.84, 0.34), bevel=0.02, op="sub")
    for x, y in JEEP_WHEELS:
        if y > 0:
            sx = math.copysign(1, x)
            hard.cylinder((sx * 0.3, y, WHEEL_R), (sx * 0.5, y, WHEEL_R), 0.235, rnd=0.01, op="sub")

    # Grille with slots and set-in headlights.
    hard.box((0, -0.875, 0.33), (0.6, 0.05, 0.28), bevel=0.012)
    for i in range(9):
        hard.box((-0.16 + i * 0.04, -0.9, 0.33), (0.022, 0.05, 0.17), bevel=0.006, op="sub")
    for sx in (-1, 1):
        hard.cylinder((sx * 0.235, -0.92, 0.37), (sx * 0.235, -0.87, 0.37), 0.048, rnd=0.004, op="sub")
        hard.sphere((sx * 0.235, -0.885, 0.37), 0.04, (1, 0.5, 1))
        hard.torus((sx * 0.235, -0.9, 0.37), 0.048, 0.008, rx(math.pi / 2))
    # Hood star, hinge line and side latches.
    hard.star((0, -0.6, 0.484), 0.11, 0.014, Matrix.Rotation(math.pi, 3, "Z"))
    hard.box((0, -0.3, 0.482), (0.5, 0.012, 0.01), bevel=0.003, op="sub")
    for sx in (-1, 1):
        hard.box((sx * 0.29, -0.58, 0.4), (0.02, 0.05, 0.03), bevel=0.006)

    # Flat front fenders dropping to the bumper; bumper and its mounts; tow hooks.
    for sx in (-1, 1):
        hard.box((sx * 0.38, -0.56, 0.435), (0.18, 0.52, 0.026), bevel=0.008)
        hard.box((sx * 0.38, -0.82, 0.39), (0.18, 0.026, 0.1), rx(-0.35), bevel=0.008)
        hard.box((sx * 0.25, -0.88, 0.24), (0.05, 0.1, 0.05), bevel=0.01)
        hard.torus((sx * 0.3, -0.97, 0.24), 0.03, 0.009, Matrix.Rotation(math.pi / 2, 3, "Y"))
    hard.box((0, -0.93, 0.24), (0.86, 0.06, 0.07), bevel=0.015)

    # Chassis: frame rails, axles and differentials (seen between the wheels).
    for sx in (-1, 1):
        hard.box((sx * 0.24, -0.05, 0.22), (0.08, 1.6, 0.07), bevel=0.01)
    for _x, y in JEEP_WHEELS[::2]:
        hard.cylinder((-0.34, y, WHEEL_R), (0.34, y, WHEEL_R), 0.028, rnd=0.006)
        hard.sphere((0.08, y, WHEEL_R), 0.065, (1, 0.8, 1))

    # Fold-down windscreen frame, hinged on the scuttle.
    lean = rx(-0.22)
    hard.box((0, -0.21, 0.66), (0.72, 0.03, 0.3), lean, bevel=0.01)
    hard.box((0, -0.21, 0.66), (0.62, 0.1, 0.21), lean, bevel=0.01, op="sub")
    for sx in (-1, 1):
        hard.cylinder((sx * 0.37, -0.23, 0.51), (sx * 0.32, -0.23, 0.51), 0.018, rnd=0.004)

    # Seats: two buckets and a rear bench.
    for sx in (-1, 1):
        panel.box((sx * 0.16, 0.08, 0.41), (0.24, 0.24, 0.07), bevel=0.025)
        panel.box((sx * 0.16, 0.22, 0.53), (0.24, 0.05, 0.22), rx(0.15), bevel=0.02)
    panel.box((0, 0.64, 0.41), (0.58, 0.18, 0.07), bevel=0.025)

    # Steering column and wheel (left-hand drive), dashboard gauges.
    a, b = V((-0.16, -0.16, 0.44)), V((-0.16, -0.06, 0.6))
    hard.cylinder(a, b, 0.015, rnd=0.004)
    hard.torus(b, 0.08, 0.012, B.along_z(a, b))
    hard.cylinder(b, b + (b - a).normalized() * 0.01, 0.022, rnd=0.004)
    for x in (0.02, 0.1):
        hard.cylinder((x, -0.17, 0.44), (x, -0.155, 0.44), 0.025, rnd=0.004)

    # Pintle machine gun on a post in the back.
    hard.cylinder((0, 0.44, 0.37), (0, 0.44, 0.7), 0.022, rnd=0.005)
    hard.cylinder((0, 0.44, 0.68), (0, 0.44, 0.73), 0.035, rnd=0.008)
    hard.box((0, 0.42, 0.77), (0.07, 0.24, 0.08), bevel=0.012)
    hard.cylinder((0, 0.32, 0.775), (0, 0.12, 0.775), 0.03, rnd=0.006)
    hard.cylinder((0, 0.14, 0.775), (0, -0.08, 0.775), 0.016, rnd=0.004)
    hard.box((0.07, 0.43, 0.75), (0.07, 0.1, 0.08), bevel=0.01)
    hard.box((0, 0.56, 0.78), (0.03, 0.08, 0.03), bevel=0.008)

    # Spare wheel and jerry can on the back, tail lights, side stars and grab handles.
    hard.torus((0, 0.82, 0.37), 0.125, 0.052, rx(math.pi / 2))
    hard.cylinder((0, 0.77, 0.37), (0, 0.86, 0.37), 0.075, rnd=0.012)
    hard.box((0, 0.785, 0.37), (0.06, 0.05, 0.2), bevel=0.01)
    hard.box((0.28, 0.83, 0.37), (0.12, 0.08, 0.2), bevel=0.012)
    hard.box((0.28, 0.83, 0.49), (0.05, 0.03, 0.04), bevel=0.008)
    for sx in (-1, 1):
        hard.box((sx * 0.32, 0.765, 0.44), (0.05, 0.02, 0.04), bevel=0.006)
        side = plane((sx, 0, 0))
        hard.star((sx * 0.37, 0.36, 0.36), 0.075, 0.012, side)
        hard.torus((sx * 0.372, 0.0, 0.43), 0.035, 0.008, plane((0, 1, 0), (sx, 0, 0)), (1, 1, 1))
    return s


def wheel(B, s):
    """One jeep wheel centred on the origin, axle along X."""
    hard = B.Layer(s, B.HARD)
    axle = Matrix.Rotation(math.pi / 2, 3, "Y")
    hard.torus((0, 0, 0), 0.14, 0.056, axle, (1, 1, 1.2))
    hard.cylinder((-0.05, 0, 0), (0.05, 0, 0), 0.125, rnd=0.01)
    for sx in (-1, 1):
        hard.cylinder((sx * 0.04, 0, 0), (sx * 0.08, 0, 0), 0.1, rnd=0.008, op="sub")
        hard.cylinder((sx * 0.02, 0, 0), (sx * 0.055, 0, 0), 0.06, rnd=0.012)
        for i in range(5):
            a = i * 2 * math.pi / 5
            hard.sphere((sx * 0.056, math.cos(a) * 0.036, math.sin(a) * 0.036), 0.009)
    # Chunky tread lugs, staggered left and right.
    n = 22
    for i in range(n):
        for sx in (-1, 1):
            R = rx((i + (0.5 if sx > 0 else 0)) * 2 * math.pi / n)
            hard.box(R @ V((sx * 0.028, 0, 0.19)), (0.036, 0.026, 0.024), R, bevel=0.007)
    return s


# ---------------------------------------------------------------- tank

def tank(B, s):
    panel, hard = B.Layer(s, 0.006), B.Layer(s, B.HARD)
    # Tracks: a stadium loop each side with grousers along the top and round the ends.
    for sx in (-1, 1):
        x0, x1, xc = sx * 0.28, sx * 0.48, sx * 0.38
        for y in (-0.66, 0.66):
            hard.cylinder((x0, y, 0.15), (x1, y, 0.15), 0.15, rnd=0.02)
        hard.box((xc, 0, 0.15), (0.2, 1.32, 0.3), bevel=0.02)
        for i in range(23):
            hard.box((xc, -0.66 + i * 0.06, 0.302), (0.2, 0.024, 0.016), bevel=0.005)
        for i in range(1, 8):
            t = i * math.pi / 8
            for yc, sign in ((-0.66, -1), (0.66, 1)):
                c = V((xc, yc + sign * 0.152 * math.sin(t), 0.15 + 0.152 * math.cos(t)))
                hard.box(c, (0.2, 0.024, 0.016), rx(-sign * t), bevel=0.005)
        # Road wheels on bogies, drive sprocket in front, idler at the back.
        xo, xw = sx * 0.47, sx * 0.525
        for y in (-0.44, -0.22, 0.0, 0.22, 0.44):
            hard.cylinder((xo, y, 0.12), (xw, y, 0.12), 0.085, rnd=0.012)
            hard.cylinder((xw, y, 0.12), (sx * 0.54, y, 0.12), 0.035, rnd=0.008)
        for y in (-0.33, 0.33):
            hard.box((sx * 0.5, y, 0.21), (0.05, 0.2, 0.09), bevel=0.012)
        for y, r in ((-0.66, 0.11), (0.66, 0.1)):
            hard.cylinder((xo, y, 0.15), (xw, y, 0.15), r, rnd=0.012)
            hard.cylinder((xw, y, 0.15), (sx * 0.545, y, 0.15), 0.04, rnd=0.008)
        for i in range(10):
            a = i * math.pi / 5
            hard.sphere((sx * 0.5, -0.66 + math.cos(a) * 0.115, 0.15 + math.sin(a) * 0.115), 0.016)

    # Hull: lower body, superstructure over the tracks, sloped glacis and a rounded nose.
    panel.box((0, 0, 0.25), (0.56, 1.5, 0.22), bevel=0.02)
    panel.box((0, 0.06, 0.4), (0.98, 1.36, 0.14), bevel=0.02)
    panel.box((0, -0.66, 0.35), (0.92, 0.36, 0.07), rx(0.55), bevel=0.02)
    panel.cylinder((-0.3, -0.74, 0.22), (0.3, -0.74, 0.22), 0.1, rnd=0.03)
    # Engine deck grilles and the rear plate with tow hooks and exhausts.
    for i in range(6):
        hard.box((0, 0.42 + i * 0.045, 0.47), (0.42, 0.018, 0.02), bevel=0.004, op="sub")
    for sx in (-1, 1):
        hard.torus((sx * 0.2, 0.75, 0.3), 0.03, 0.01, Matrix.Rotation(math.pi / 2, 3, "Y"))
        hard.cylinder((sx * 0.12, 0.72, 0.36), (sx * 0.12, 0.78, 0.36), 0.03, rnd=0.006)
        hard.cylinder((sx * 0.12, 0.76, 0.36), (sx * 0.12, 0.79, 0.36), 0.022, rnd=0.004, op="sub")
    # Driver hatches, periscopes, hull machine gun, headlights with guards.
    for sx in (-1, 1):
        hard.cylinder((sx * 0.18, -0.44, 0.46), (sx * 0.18, -0.44, 0.49), 0.075, rnd=0.012)
        hard.torus((sx * 0.18, -0.44, 0.495), 0.03, 0.007, rx(math.pi / 2))
        hard.box((sx * 0.18, -0.55, 0.49), (0.06, 0.03, 0.04), bevel=0.008)
        hard.cylinder((sx * 0.36, -0.72, 0.45), (sx * 0.36, -0.79, 0.45), 0.03, rnd=0.008)
        hard.torus((sx * 0.36, -0.77, 0.45), 0.038, 0.006, rx(math.pi / 2))
    hard.sphere((0.2, -0.75, 0.39), 0.045)
    hard.cylinder((0.2, -0.78, 0.39), (0.2, -0.9, 0.39), 0.013, rnd=0.004)
    # Stowed shovel and tow cable on the deck, stars on the sides, turret ring.
    hard.box((-0.34, 0.2, 0.48), (0.03, 0.5, 0.015), bevel=0.005)
    hard.box((-0.34, -0.08, 0.48), (0.07, 0.1, 0.015), bevel=0.008)
    hard.torus((0.34, 0.25, 0.475), 0.07, 0.01)
    for sx in (-1, 1):
        hard.star((sx * 0.49, 0.2, 0.4), 0.06, 0.012, plane((sx, 0, 0)))
    tx, ty, tz = TURRET_AT
    hard.cylinder((tx, ty, 0.46), (tx, ty, tz), 0.32, rnd=0.008)
    return s


def turret(B, s):
    """The turret sits on its ring at the origin; the gun points along -Y."""
    panel, hard = B.Layer(s, 0.01), B.Layer(s, B.HARD)
    panel.s.dome(V((0, 0.03, 0)), (0.33, 0.39, 0.25), Matrix.Identity(3), 0.0, panel.k)
    panel.ellipsoid((0, 0.28, 0.1), 0.23, 0.17, 0.1)
    hard.cylinder((0, 0, 0), (0, 0, 0.04), 0.3, rnd=0.01)
    # Mantlet and gun with collar and muzzle brake, coaxial machine gun.
    hard.box((0, -0.37, 0.11), (0.3, 0.1, 0.17), bevel=0.035)
    hard.cylinder((0, -0.4, 0.11), (0, -0.5, 0.11), 0.06, rnd=0.012)
    hard.cylinder((0, -0.45, 0.11), (0, -1.05, 0.11), 0.04, rnd=0.008)
    hard.cylinder((0, -0.98, 0.11), (0, -1.08, 0.11), 0.056, rnd=0.012)
    hard.cylinder((0, -1.0, 0.11), (0, -1.1, 0.11), 0.028, rnd=0.004, op="sub")
    hard.cylinder((0.1, -0.4, 0.09), (0.1, -0.5, 0.09), 0.014, rnd=0.004)
    # Commander's cupola with open-able hatch and an anti-aircraft gun; loader's hatch; periscopes.
    hard.cylinder((0.11, 0.1, 0.17), (0.11, 0.1, 0.28), 0.09, rnd=0.015)
    hard.cylinder((0.11, 0.1, 0.28), (0.11, 0.1, 0.3), 0.078, rnd=0.008)
    hard.torus((0.11, 0.1, 0.305), 0.03, 0.007, rx(math.pi / 2))
    for i in range(6):
        a = i * math.pi / 3
        hard.box((0.11 + math.cos(a) * 0.09, 0.1 + math.sin(a) * 0.09, 0.24), (0.03, 0.03, 0.035), plane((math.cos(a), math.sin(a), 0)), bevel=0.006)
    hard.cylinder((-0.12, 0.06, 0.19), (-0.12, 0.06, 0.245), 0.07, rnd=0.012)
    hard.torus((-0.12, 0.06, 0.25), 0.025, 0.006, rx(math.pi / 2))
    hard.box((-0.05, -0.2, 0.22), (0.06, 0.04, 0.05), bevel=0.01)
    hard.cylinder((0.11, 0.2, 0.28), (0.11, 0.2, 0.42), 0.012, rnd=0.004)
    hard.box((0.11, 0.18, 0.44), (0.04, 0.14, 0.05), bevel=0.01)
    hard.cylinder((0.11, 0.12, 0.44), (0.11, -0.12, 0.44), 0.013, rnd=0.004)
    # Stars on the turret sides, lifting eyes, an antenna.
    for sx in (-1, 1):
        hard.star((sx * 0.3, 0.06, 0.1), 0.07, 0.03, plane((sx, 0, 0)))
        hard.torus((sx * 0.2, -0.2, 0.2), 0.025, 0.007, plane((0, 1, 0)))
    hard.cylinder((-0.2, 0.3, 0.12), (-0.2, 0.3, 0.2), 0.025, rnd=0.006)
    hard.cylinder((-0.2, 0.3, 0.2), (-0.2, 0.3, 0.75), 0.008, rnd=0.003)
    hard.sphere((-0.2, 0.3, 0.755), 0.014)
    return s


# name: (sculpt function, voxel size, clamp at the table, triangle budget)
MODELS = {
    "jeep": (jeep, 0.0045, True, 60_000),
    "jeep-wheel": (wheel, 0.0025, False, 8_000),
    "tank": (tank, 0.0045, True, 60_000),
    "tank-turret": (turret, 0.003, True, 40_000),
}


def build(name, B):
    fn, voxel, floor, _tris = MODELS[name]
    return fn(B, B.Sculpt()).mesh(voxel, floor)
