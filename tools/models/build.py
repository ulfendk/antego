"""
Builds the plastic army-men models for Antego with headless Blender.

Every figure is sculpted from code as a signed distance field: capsule limbs
posed with two-bone IK, rounded-box and cylinder props, a helmet dome and a
thin base plate, joined with smooth unions (the soft fillets of moulded
plastic) and meshed with marching cubes. Then the toy details are added: a
mould parting-line ridge along the silhouette, and per-vertex baked ambient
occlusion (R) and curvature (G) that the game shader uses for contact shading
and worn edges.

Output (committed): <out>/<rank>.glb (LOD0), <rank>-lod1.glb, manifest.json.
Units: 1 = one board square. Figures face -Y in Blender (+Z in glTF).

    blender --background --factory-startup --python build.py -- --out DIR [--only r1,r2] [--force] [--preview]
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from skimage import measure

LOD0_TRIS = 30_000
LOD1_TRIS = 5_000
VOXEL = 0.0028
BASE_TOP = 0.024
SOFT = 0.012  # blend radius between body parts
HARD = 0.003  # blend radius for props (crisper, but still moulded)

V = Vector


# ---------------------------------------------------------------- scene helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.light_settings.distance = 0.12  # AO bake distance


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def frame(direction, up=V((0, 0, 1))):
    """Rotation whose local +X points along direction and +Z is as close to `up` as possible."""
    x = V(direction).normalized()
    up = V(up)
    if abs(x.dot(up.normalized())) > 0.99:
        up = V((0, 1, 0))
    y = up.cross(x).normalized()
    z = x.cross(y).normalized()
    return Matrix((x, y, z)).transposed()


def rot3(m):
    return m.to_3x3() if len(m) == 4 else m


def along_z(a, b):
    """Rotation taking local +Z onto a→b."""
    return V((0, 0, 1)).rotation_difference((V(b) - V(a)).normalized()).to_matrix()


# ---------------------------------------------------------------- signed distance sculpting

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Prim:
    def __init__(self, fn, lo, hi, k, op="add"):
        self.fn, self.lo, self.hi, self.k, self.op = fn, V(lo), V(hi), k, op


def _local(X, Y, Z, c, R):
    """World grid coordinates → primitive-local coordinates (R maps local → world)."""
    px, py, pz = X - c.x, Y - c.y, Z - c.z
    return (
        R[0][0] * px + R[1][0] * py + R[2][0] * pz,
        R[0][1] * px + R[1][1] * py + R[2][1] * pz,
        R[0][2] * px + R[1][2] * py + R[2][2] * pz,
    )


def _box_bounds(c, R, half):
    corners = [R @ V((sx * half[0], sy * half[1], sz * half[2])) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    lo = V((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    hi = V((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return c + lo, c + hi


class Sculpt:
    def __init__(self):
        self.prims = []

    def add(self, fn, lo, hi, k, op="add"):
        self.prims.append(Prim(fn, lo, hi, k, op))

    # --- primitives (all take a blend radius k)

    def round_cone(self, a, b, r1, r2, k):
        a, b = V(a), V(b)
        ba = b - a
        l2 = max(ba.dot(ba), 1e-10)
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2

        def fn(X, Y, Z):
            pax, pay, paz = X - a.x, Y - a.y, Z - a.z
            y = pax * ba.x + pay * ba.y + paz * ba.z
            z = y - l2
            qx, qy, qz = pax * l2 - ba.x * y, pay * l2 - ba.y * y, paz * l2 - ba.z * y
            x2 = qx * qx + qy * qy + qz * qz
            y2 = y * y * l2
            z2 = z * z * l2
            kk = math.copysign(1.0, rr) * rr * rr * x2
            d_end = np.sqrt(x2 + z2) * il2 - r2
            d_start = np.sqrt(x2 + y2) * il2 - r1
            d_mid = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
            return np.where(np.sign(z) * a2 * z2 > kk, d_end, np.where(np.sign(y) * a2 * y2 < kk, d_start, d_mid))

        r = max(r1, r2)
        lo = V((min(a.x, b.x) - r, min(a.y, b.y) - r, min(a.z, b.z) - r))
        hi = V((max(a.x, b.x) + r, max(a.y, b.y) + r, max(a.z, b.z) + r))
        self.add(fn, lo, hi, k)

    def cone(self, a, b, ra, rb, k, op="add"):
        """Capped cone from a (radius ra) to b (radius rb), flat ends."""
        a, b = V(a), V(b)
        ba = b - a
        baba = max(ba.dot(ba), 1e-10)
        rba = rb - ra
        kk = rba * rba + baba

        def fn(X, Y, Z):
            pax, pay, paz = X - a.x, Y - a.y, Z - a.z
            papa = pax * pax + pay * pay + paz * paz
            paba = (pax * ba.x + pay * ba.y + paz * ba.z) / baba
            x = np.sqrt(np.maximum(papa - paba * paba * baba, 0.0))
            cax = np.maximum(0.0, x - np.where(paba < 0.5, ra, rb))
            cay = np.abs(paba - 0.5) - 0.5
            f = np.clip((rba * (x - ra) + paba * baba) / kk, 0.0, 1.0)
            cbx = x - ra - f * rba
            cby = paba - f
            sgn = np.where((cbx < 0.0) & (cay < 0.0), -1.0, 1.0)
            return sgn * np.sqrt(np.minimum(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba))

        r = max(ra, rb)
        lo = V((min(a.x, b.x) - r, min(a.y, b.y) - r, min(a.z, b.z) - r))
        hi = V((max(a.x, b.x) + r, max(a.y, b.y) + r, max(a.z, b.z) + r))
        self.add(fn, lo, hi, k, op)

    def ball(self, c, r, k):
        c = V(c)
        self.add(lambda X, Y, Z: np.sqrt((X - c.x) ** 2 + (Y - c.y) ** 2 + (Z - c.z) ** 2) - r, c - V((r, r, r)), c + V((r, r, r)), k)

    def ellipsoid(self, c, radii, R, k, op="add"):
        c, R, (rx, ry, rz) = V(c), rot3(R), radii

        def fn(X, Y, Z):
            x, y, z = _local(X, Y, Z, c, R)
            k0 = np.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2)
            k1 = np.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2)
            return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

        lo, hi = _box_bounds(c, R, radii)
        self.add(fn, lo, hi, k, op)

    def dome(self, c, radii, R, cut, k):
        """Ellipsoid cut flat below local z = cut * rz (a helmet shell)."""
        c, R, (rx, ry, rz) = V(c), rot3(R), radii

        def fn(X, Y, Z):
            x, y, z = _local(X, Y, Z, c, R)
            k0 = np.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2)
            k1 = np.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2)
            return np.maximum(k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), cut * rz - z)

        lo, hi = _box_bounds(c, R, radii)
        self.add(fn, lo, hi, k)

    def box(self, c, half, R, rnd, k):
        c, R = V(c), rot3(R)
        hx, hy, hz = (max(h - rnd, 1e-5) for h in half)

        def fn(X, Y, Z):
            x, y, z = _local(X, Y, Z, c, R)
            qx, qy, qz = np.abs(x) - hx, np.abs(y) - hy, np.abs(z) - hz
            outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
            return outside + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0) - rnd

        lo, hi = _box_bounds(c, R, half)
        self.add(fn, lo, hi, k)

    def cylinder(self, a, b, r, rnd, k):
        a, b = V(a), V(b)
        h = (b - a).length / 2
        c = (a + b) / 2
        R = along_z(a, b)
        rnd = min(rnd, r * 0.9, h * 0.9)

        def fn(X, Y, Z):
            x, y, z = _local(X, Y, Z, c, R)
            dx = np.sqrt(x * x + y * y) - (r - rnd)
            dz = np.abs(z) - (h - rnd)
            return np.minimum(np.maximum(dx, dz), 0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dz, 0) ** 2) - rnd

        lo, hi = _box_bounds(c, R, (r, r, h))
        self.add(fn, lo, hi, k)

    def torus(self, c, major, minor, R, k, scale=(1, 1, 1)):
        c, R = V(c), rot3(R)
        sx, sy, sz = scale

        def fn(X, Y, Z):
            x, y, z = _local(X, Y, Z, c, R)
            x, y, z = x / sx, y / sy, z / sz
            q = np.sqrt(x * x + y * y) - major
            return (np.sqrt(q * q + z * z) - minor) * min(scale)

        e = major + minor
        lo, hi = _box_bounds(c, R, (e * sx, e * sy, minor * sz))
        self.add(fn, lo, hi, k)

    def slab(self, c, w, d, h, corner, edge, k):
        """Rounded-rectangle plate with softened top/bottom edges (army-men base)."""
        c = V(c)
        hx, hy = w / 2 - corner, d / 2 - corner

        def fn(X, Y, Z):
            qx, qy = np.abs(X - c.x) - hx, np.abs(Y - c.y) - hy
            d2 = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - corner
            wx, wz = d2 + edge, np.abs(Z - c.z) - (h / 2 - edge)
            return np.minimum(np.maximum(wx, wz), 0) + np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wz, 0) ** 2) - edge

        self.add(fn, c - V((w / 2, d / 2, h / 2)), c + V((w / 2, d / 2, h / 2)), k)

    def sheet(self, origin, width, height, thickness, wave, k):
        """A cloth sheet hanging from `origin`: local x in [0, width], z in [-height, 0], offset y = wave(x, z)."""
        o = V(origin)

        def fn(X, Y, Z):
            x, y, z = X - o.x, Y - o.y, Z - o.z
            dy = np.abs(y - wave(x, z)) - thickness / 2
            rx, rz = np.abs(x - width / 2) - width / 2, np.abs(z + height / 2) - height / 2
            rect = np.sqrt(np.maximum(rx, 0) ** 2 + np.maximum(rz, 0) ** 2) + np.minimum(np.maximum(rx, rz), 0)
            return np.maximum(dy * 0.7, rect)

        self.add(fn, o + V((0, -0.08, -height - 0.08)), o + V((width, 0.08, 0.02)), k)

    # --- evaluation

    def mesh(self, voxel):
        pad = 3 * voxel + SOFT
        lo = V((min(p.lo.x for p in self.prims), min(p.lo.y for p in self.prims), min(p.lo.z for p in self.prims))) - V((pad,) * 3)
        hi = V((max(p.hi.x for p in self.prims), max(p.hi.y for p in self.prims), max(p.hi.z for p in self.prims))) + V((pad,) * 3)
        lo.z = max(lo.z, -voxel * 2)
        n = [int(math.ceil((hi[i] - lo[i]) / voxel)) + 1 for i in range(3)]
        axes = [np.float32(lo[i]) + np.arange(n[i], dtype=np.float32) * np.float32(voxel) for i in range(3)]
        D = np.full(n, 1.0, dtype=np.float32)
        for p in self.prims:
            m = p.k + 2 * voxel
            sl = []
            for i in range(3):
                i0 = max(0, int((p.lo[i] - m - lo[i]) / voxel))
                i1 = min(n[i], int((p.hi[i] + m - lo[i]) / voxel) + 2)
                sl.append(slice(i0, i1))
            if any(s.stop <= s.start for s in sl):
                continue
            X = axes[0][sl[0]][:, None, None]
            Y = axes[1][sl[1]][None, :, None]
            Z = axes[2][sl[2]][None, None, :]
            d = p.fn(X, Y, Z).astype(np.float32)
            block = D[sl[0], sl[1], sl[2]]
            D[sl[0], sl[1], sl[2]] = smax(block, -d, p.k) if p.op == "sub" else smin(block, d, p.k)
        # Nothing below the table.
        Zfull = axes[2][None, None, :]
        D = np.maximum(D, -Zfull)
        verts, faces, _normals, _ = measure.marching_cubes(D, level=0.0, spacing=(voxel, voxel, voxel))
        verts += np.array([lo.x, lo.y, lo.z], dtype=np.float32)
        me = bpy.data.meshes.new("figure")
        me.from_pydata(verts.tolist(), [], faces.tolist())
        me.update()
        obj = link(bpy.data.objects.new("figure", me))
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=voxel * 0.05)
        # Marching cubes winds faces consistently; make sure they face outwards (+Z on the base underside is inward).
        bm.normal_update()
        low = min(bm.faces, key=lambda f: f.calc_center_median().z)
        if low.normal.z > 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        return obj


class Layer:
    """The API the pose code uses; soft body parts and hard props differ only in blend radius."""

    def __init__(self, sculpt, k):
        self.s, self.k = sculpt, k

    # soft body
    def capsule(self, a, b, r, r2=None):
        self.s.round_cone(a, b, r, r if r2 is None else r2, self.k)

    def ball(self, c, r):
        self.s.ball(c, r, self.k)

    def ellipsoid(self, c, sx, sy, sz, R=Matrix.Identity(3)):
        self.s.ellipsoid(c, (sx, sy, sz), R, self.k)

    # hard props
    def box(self, center, size, R=Matrix.Identity(3), bevel=0.004):
        self.s.box(center, tuple(x / 2 for x in size), R, bevel, self.k)

    def cylinder(self, a, b, r1, r2=None, rnd=0.003):
        if r2 is None or abs(r2 - r1) < 1e-6:
            self.s.cylinder(a, b, r1, rnd, self.k)
        else:
            self.s.cone(a, b, r1, r2, self.k)

    def sphere(self, c, r, scale=(1, 1, 1)):
        self.s.ellipsoid(c, (r * scale[0], r * scale[1], r * scale[2]), Matrix.Identity(3), self.k)

    def torus(self, c, major, minor, R=Matrix.Identity(3), scale=(1, 1, 1)):
        self.s.torus(c, major, minor, R, self.k, scale)


def base_plate(props, w=0.46, d=0.36, cx=0.0, cy=0.0):
    """Thin army-men base with a sprue nub at the back."""
    props.s.slab(V((cx, cy, BASE_TOP / 2)), w, d, BASE_TOP, corner=min(w, d) * 0.28, edge=BASE_TOP * 0.35, k=0.0)
    props.cylinder((cx + w * 0.12, cy + d / 2 - 0.006, BASE_TOP * 0.45), (cx + w * 0.12, cy + d / 2 + 0.014, BASE_TOP * 0.45), 0.009, rnd=0.003)


# ---------------------------------------------------------------- skeleton / posing

def ik(root, target, l1, l2, pole):
    """Analytic two-bone IK. Returns the middle joint (elbow/knee) and the clamped end."""
    root, target, pole = V(root), V(target), V(pole)
    d = target - root
    dist = min(max(d.length, 1e-4), (l1 + l2) * 0.999)
    dirn = d.normalized()
    end = root + dirn * dist
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    p = pole - dirn * pole.dot(dirn)
    if p.length < 1e-6:
        p = V((0, 1, 0))
    return root + dirn * a + p.normalized() * h, end


class Soldier:
    """Army-man proportions (~0.8 tall). Pose values are in figure space: -Y is forward, -X is his right."""

    THIGH, SHIN = 0.17, 0.165
    UPPER, FORE = 0.125, 0.115

    def __init__(self, pose):
        self.p = {
            "pelvis": 0.40,
            "lean": 0.0,  # degrees forward
            "twist": 0.0,  # degrees, positive turns his chest to his left
            "head": (0.0, 0.0),  # pitch (down +), yaw
            "hands": {"r": (-0.12, -0.02, 0.26), "l": (0.12, -0.02, 0.26)},
            "elbows": {"r": (-1, 0.6, -0.3), "l": (1, 0.6, -0.3)},
            "feet": {"r": (-0.07, 0.0, 0.06), "l": (0.07, 0.0, 0.06)},
            "knees": {"r": (0, -1, 0.1), "l": (0, -1, 0.1)},
            "toes": {},
            "fists": True,
        }
        self.p.update(pose)
        self.j = {}

    def solve(self):
        p, j = self.p, self.j
        pel = V((0, 0, p["pelvis"]))
        self.torso = (
            Matrix.Translation(pel)
            @ Matrix.Rotation(math.radians(p["twist"]), 4, "Z")
            @ Matrix.Rotation(math.radians(p["lean"]), 4, "X")
        )
        t = self.torso
        j["pelvis"] = pel
        j["waist"] = t @ V((0, 0, 0.075))
        j["chest"] = t @ V((0, 0, 0.16))
        j["neck"] = t @ V((0, -0.004, 0.262))
        for s, x in (("r", -1), ("l", 1)):
            j[s + "_shoulder"] = t @ V((x * 0.1, 0.004, 0.226))
            j[s + "_hip"] = V((x * 0.05, 0, p["pelvis"] - 0.02))
            j[s + "_elbow"], j[s + "_hand"] = ik(j[s + "_shoulder"], p["hands"][s], self.UPPER, self.FORE, p["elbows"][s])
            j[s + "_knee"], j[s + "_ankle"] = ik(j[s + "_hip"], p["feet"][s], self.THIGH, self.SHIN, p["knees"][s])
        hp, hy = p["head"]
        self.head = (
            Matrix.Translation(j["neck"])
            @ Matrix.Rotation(math.radians(p["twist"] + hy), 4, "Z")
            @ Matrix.Rotation(math.radians(p["lean"] * 0.4 + hp), 4, "X")
        )
        j["head"] = self.head @ V((0, -0.004, 0.06))
        return j

    def build(self, soft, hard):
        j = self.solve()
        tr = self.torso.to_3x3()
        hr = self.head.to_3x3()
        t = self.torso
        # Torso: hips, belly and a chunky chest, blended soft.
        soft.ellipsoid(j["pelvis"] + t.to_3x3() @ V((0, 0.004, 0.012)), 0.08, 0.056, 0.056, tr)
        soft.ellipsoid(j["waist"], 0.076, 0.052, 0.056, tr)
        soft.ellipsoid(j["chest"], 0.088, 0.058, 0.075, tr)
        soft.ellipsoid(t @ V((0, 0.004, 0.215)), 0.098, 0.048, 0.036, tr)  # shoulder yoke
        soft.capsule(j["neck"], self.head @ V((0, 0, 0.035)), 0.026)
        # Head with nose, chin and ears; the helmet is a hard prop.
        soft.ellipsoid(j["head"], 0.042, 0.045, 0.048, hr)
        soft.ball(self.head @ V((0, -0.043, 0.055)), 0.009)
        soft.ellipsoid(self.head @ V((0, -0.028, 0.03)), 0.024, 0.018, 0.016, hr)
        for x in (-1, 1):
            soft.ellipsoid(self.head @ V((x * 0.037, 0.0, 0.058)), 0.008, 0.011, 0.014, hr)
        for s in ("r", "l"):
            soft.capsule(j[s + "_shoulder"], j[s + "_elbow"], 0.035, 0.029)
            soft.capsule(j[s + "_elbow"], j[s + "_hand"], 0.029, 0.024)
            if self.p["fists"]:
                soft.ball(j[s + "_hand"], 0.026)
            else:
                d = (j[s + "_hand"] - j[s + "_elbow"]).normalized()
                soft.ellipsoid(j[s + "_hand"] + d * 0.012, 0.012, 0.022, 0.026, frame(d, V((0, -1, 0))) @ Matrix.Rotation(math.pi / 2, 3, "Y"))
            soft.capsule(j[s + "_hip"], j[s + "_knee"], 0.05, 0.04)
            soft.capsule(j[s + "_knee"], j[s + "_ankle"], 0.039, 0.033)
            # Trousers bloused over the boots, then the boot pointing forward.
            soft.ball(j[s + "_ankle"] + V((0, 0, 0.02)), 0.038)
            toe = V(self.p["toes"].get(s, (0, -1, 0))).normalized()
            soft.capsule(j[s + "_ankle"] + V((0, 0.012, -0.014)), j[s + "_ankle"] + toe * 0.066 + V((0, 0, -0.018)), 0.03, 0.025)
        # Helmet: an M1-style dome with a flared rim, tipped forward like the toys.
        hm = self.head @ Matrix.Rotation(math.radians(-8), 4, "X")
        hard.s.dome(hm @ V((0, 0.0, 0.074)), (0.061, 0.067, 0.054), hm.to_3x3(), -0.18, HARD)
        hard.torus(hm @ V((0, 0.001, 0.064)), 0.062, 0.0072, hm.to_3x3(), scale=(1.0, 1.08, 0.75))
        # Collar, webbing belt with pouches, a canteen and a small pack on the back.
        soft.s.torus(t @ V((0, -0.002, 0.245)), 0.03, 0.009, tr, SOFT * 0.5, (1.1, 1.0, 1.0))
        hard.torus(t @ V((0, 0.002, 0.058)), 0.07, 0.009, tr, scale=(1.0, 0.74, 1.4))
        for x in (-0.04, 0.04):
            hard.box(t @ V((x, -0.046, 0.058)), (0.028, 0.016, 0.028), tr, bevel=0.004)
        hard.box(t @ V((0, 0.06, 0.17)), (0.084, 0.034, 0.09), tr, bevel=0.01)
        hard.cylinder(t @ V((0.066, 0.034, 0.05)), t @ V((0.066, 0.034, 0.005)), 0.018, rnd=0.006)
        return j


# ---------------------------------------------------------------- prop library

def rifle(p, butt, muzzle, up=(0, 0, 1)):
    butt, muzzle = V(butt), V(muzzle)
    d = muzzle - butt
    R = frame(d, V(up))
    L = d.length
    at = lambda t, z=0.0: butt + d * t + R @ V((0, 0, z))
    p.box(at(0.13, -0.004), (L * 0.26, 0.024, 0.046), R, bevel=0.008)  # butt stock
    p.box(at(0.43, 0.0), (L * 0.36, 0.024, 0.03), R, bevel=0.007)  # fore stock
    p.box(at(0.34, 0.021), (0.07, 0.017, 0.02), R, bevel=0.005)  # receiver
    p.cylinder(at(0.55, 0.013), at(1.0, 0.013), 0.0095, rnd=0.003)  # barrel
    p.box(at(0.33, -0.024), (0.028, 0.012, 0.022), R, bevel=0.004)  # magazine


def pistol(p, hand, direction):
    hand, d = V(hand), V(direction).normalized()
    R = frame(d)
    p.box(hand + d * 0.036 + R @ V((0, 0, 0.014)), (0.072, 0.017, 0.022), R, bevel=0.005)
    p.box(hand + R @ V((0, 0, -0.01)), (0.022, 0.016, 0.042), R, bevel=0.005)


def binoculars(p, center, direction):
    c, d = V(center), V(direction).normalized()
    R = frame(d)
    side = R @ V((0, 1, 0))
    for s in (-1, 1):
        a = c + side * s * 0.022
        p.cylinder(a - d * 0.03, a + d * 0.035, 0.017, rnd=0.004)
    p.box(c, (0.03, 0.03, 0.014), R, bevel=0.004)


def megaphone(p, mouth, direction):
    mouth, d = V(mouth), V(direction).normalized()
    p.cylinder(mouth + d * 0.004, mouth + d * 0.13, 0.013, 0.048)
    p.s.cone(mouth + d * 0.03, mouth + d * 0.135, 0.006, 0.041, 0.002, op="sub")
    p.torus(mouth + d * 0.13, 0.047, 0.005, along_z(V((0, 0, 0)), d))
    p.box(mouth + d * 0.05 + V((0, 0, -0.03)), (0.014, 0.014, 0.04), frame(d), bevel=0.004)


def folded_map(p, left, right):
    """An unfolded map held between both hands, tipped towards his face."""
    left, right = V(left), V(right)
    mid = (left + right) / 2 + V((0, -0.012, 0.03))
    for a in (left, right):
        d = mid - a
        R = frame(d, V((0, 0.5, 1)))
        p.box((a + mid) / 2 + R @ V((0, 0, 0.03)), (d.length + 0.012, 0.004, 0.11), R @ Matrix.Rotation(math.radians(90), 3, "X"), bevel=0.0015)


# ---------------------------------------------------------------- ranks

def rifle_between_hands(p, j, s, back=0.1):
    """Rifle butt at the shoulder behind the right hand, barrel out past the left hand."""
    r, l = j["r_hand"], j["l_hand"]
    d = (l - r).normalized()
    rifle(p, r - d * back + V((0, 0, 0.012)), l + d * 0.17 + V((0, 0, 0.012)))


POSES = {
    # Binoculars pressed to the eyes, feet apart.
    "marskal": {
        "pose": {
            "hands": {"r": (-0.032, -0.12, 0.7), "l": (0.032, -0.12, 0.7)},
            "elbows": {"r": (-1, 0.1, -0.7), "l": (1, 0.1, -0.7)},
            "feet": {"r": (-0.085, 0.03, 0.06), "l": (0.085, -0.03, 0.06)},
            "toes": {"r": (-0.35, -1, 0), "l": (0.35, -1, 0)},
            "head": (-4, 0),
        },
        "props": [lambda p, j, s: binoculars(p, (j["r_hand"] + j["l_hand"]) / 2 + V((0, -0.012, 0.012)), V((0, -1, 0.05)))],
    },
    # Barking into a megaphone, the other arm pointing ahead.
    "general": {
        "pose": {
            "hands": {"r": (-0.03, -0.1, 0.66), "l": (0.14, -0.3, 0.62)},
            "elbows": {"r": (-1, 0.3, -0.6), "l": (1, 0.2, -1)},
            "feet": {"r": (-0.08, 0.06, 0.06), "l": (0.07, -0.07, 0.06)},
            "twist": 8,
            "fists": True,
        },
        "props": [lambda p, j, s: megaphone(p, s.head @ V((0, -0.05, 0.036)), s.head.to_3x3() @ V((0, -1, 0.05)))],
    },
    # Saluting at attention.
    "oberst": {
        "pose": {
            "hands": {"r": (-0.05, -0.065, 0.715), "l": (0.108, 0.0, 0.27)},
            "elbows": {"r": (-1, -0.1, 0.1), "l": (1, 0.3, 0)},
            "feet": {"r": (-0.05, 0.0, 0.06), "l": (0.05, 0.0, 0.06)},
            "toes": {"r": (-0.4, -1, 0), "l": (0.4, -1, 0)},
            "fists": False,
        },
    },
    # Reading a map held open in both hands.
    "major": {
        "pose": {
            "hands": {"r": (-0.1, -0.17, 0.47), "l": (0.1, -0.17, 0.47)},
            "elbows": {"r": (-1, 0.3, -1), "l": (1, 0.3, -1)},
            "head": (24, 0),
            "feet": {"r": (-0.07, 0.02, 0.06), "l": (0.07, -0.02, 0.06)},
        },
        "props": [lambda p, j, s: folded_map(p, j["r_hand"], j["l_hand"])],
    },
    # Standing, aiming the rifle.
    "kaptajn": {
        "pose": {
            "hands": {"r": (-0.055, -0.07, 0.6), "l": (0.005, -0.25, 0.62)},
            "elbows": {"r": (-1, 0.2, -0.3), "l": (0.6, 0.0, -1)},
            "feet": {"r": (-0.09, 0.08, 0.06), "l": (0.06, -0.08, 0.06)},
            "toes": {"r": (-0.8, -0.6, 0)},
            "twist": 12,
            "head": (6, -6),
        },
        "props": [lambda p, j, s: rifle_between_hands(p, j, s)],
    },
    # Pistol pointed forward, the other arm waving "follow me".
    "loejtnant": {
        "pose": {
            "hands": {"r": (-0.1, -0.3, 0.58), "l": (0.17, 0.02, 0.76)},
            "elbows": {"r": (-1, 0.2, -1), "l": (1, 0.3, -0.5)},
            "feet": {"r": (-0.07, -0.09, 0.06), "l": (0.07, 0.09, 0.06)},
            "lean": 6,
        },
        "props": [lambda p, j, s: pistol(p, j["r_hand"], j["r_hand"] - j["r_elbow"])],
    },
    # Kneeling rifleman: right knee down, left foot planted forward.
    "sergent": {
        "pose": {
            "pelvis": 0.2,
            "hands": {"r": (-0.055, -0.06, 0.42), "l": (0.005, -0.24, 0.44)},
            "elbows": {"r": (-1, 0.2, -0.3), "l": (0.8, 0.0, -1)},
            "feet": {"r": (-0.06, 0.15, 0.045), "l": (0.07, -0.11, 0.06)},
            "knees": {"r": (0, -1, -1.4), "l": (0, -1, 0.8)},
            "toes": {"r": (0, 1, -0.05)},
            "twist": 10,
            "head": (6, -6),
        },
        "props": [lambda p, j, s: rifle_between_hands(p, j, s)],
    },
    # Sweeping for mines with a detector and headphones.
    "minoer": {
        "pose": {
            "hands": {"r": (-0.05, -0.13, 0.4), "l": (0.02, -0.21, 0.44)},
            "elbows": {"r": (-1, 0.4, -0.5), "l": (1, 0.3, -0.8)},
            "feet": {"r": (-0.08, 0.06, 0.06), "l": (0.07, -0.05, 0.06)},
            "lean": 10,
            "head": (18, 0),
        },
        "props": [
            lambda p, j, s: p.cylinder(j["r_hand"] + V((0, 0.07, 0.05)), V((0.02, -0.3, BASE_TOP + 0.04)), 0.008),
            lambda p, j, s: p.cylinder(V((0.02, -0.3, BASE_TOP + 0.008)), V((0.02, -0.3, BASE_TOP + 0.026)), 0.05, rnd=0.006),
            lambda p, j, s: p.box(V((0.02, -0.29, BASE_TOP + 0.04)), (0.014, 0.03, 0.032)),
            lambda p, j, s: [p.cylinder(s.head @ V((x * 0.043, -0.002, 0.056)), s.head @ V((x * 0.056, -0.002, 0.056)), 0.019, rnd=0.004) for x in (-1, 1)],
            lambda p, j, s: p.torus(s.head @ V((0, -0.002, 0.056)), 0.052, 0.005, s.head.to_3x3() @ Matrix.Rotation(math.pi / 2, 3, "Y"), scale=(1.0, 1.0, 1.0)),
        ],
    },
    # Running forward with the rifle in one hand.
    "spejder": {
        "pose": {
            "pelvis": 0.37,
            "lean": 16,
            "hands": {"r": (-0.12, -0.13, 0.4), "l": (0.12, 0.13, 0.35)},
            "elbows": {"r": (-1, 0.5, -0.2), "l": (1, -0.5, -0.2)},
            "feet": {"r": (-0.06, -0.17, 0.09), "l": (0.06, 0.18, 0.08)},
            "knees": {"r": (0, -1, 0.3), "l": (0, -1, -0.4)},
            "toes": {"l": (0, -1, -0.8)},
            "head": (-12, 0),
        },
        "props": [lambda p, j, s: rifle(p, j["r_hand"] + V((0, 0.17, -0.07)), j["r_hand"] + V((0, -0.21, 0.08)), (-1, 0, 0.3))],
        "base_dy": 0.0,
    },
    # Sneaking in a crouch, a bush tied to his back.
    "spion": {
        "pose": {
            "pelvis": 0.26,
            "lean": 38,
            "hands": {"r": (-0.1, -0.21, 0.3), "l": (0.1, -0.17, 0.26)},
            "elbows": {"r": (-1, 0.4, -0.2), "l": (1, 0.4, -0.2)},
            "feet": {"r": (-0.08, 0.1, 0.06), "l": (0.07, -0.1, 0.06)},
            "knees": {"r": (0, -1, 0.2), "l": (0, -1, 0.2)},
            "head": (-30, 0),
        },
        "soft": [
            lambda m, j, s: [
                m.ball(s.torso @ V(off), r)
                for off, r in (
                    ((0, 0.1, 0.16), 0.05), ((-0.055, 0.1, 0.2), 0.04), ((0.055, 0.1, 0.2), 0.04),
                    ((0, 0.12, 0.22), 0.042), ((-0.06, 0.1, 0.1), 0.036), ((0.06, 0.1, 0.1), 0.036),
                    ((0, 0.14, 0.12), 0.038), ((-0.09, 0.07, 0.15), 0.03), ((0.09, 0.07, 0.15), 0.03),
                    ((0.03, 0.15, 0.18), 0.03), ((-0.03, 0.14, 0.24), 0.028), ((0, 0.11, 0.05), 0.034),
                    ((-0.04, 0.16, 0.16), 0.024), ((0.05, 0.13, 0.25), 0.026),
                )
            ]
        ],
        "props": [lambda p, j, s: pistol(p, j["r_hand"], V((0, -1, 0.1)))],
    },
}

RANKS = ["marskal", "general", "oberst", "major", "kaptajn", "loejtnant", "sergent", "minoer", "spejder", "spion", "mine", "flag"]


def build_rank(rank):
    sculpt = Sculpt()
    soft, hard = Layer(sculpt, SOFT), Layer(sculpt, HARD)

    if rank == "mine":
        base_plate(hard, 0.42, 0.42)
        z = BASE_TOP
        hard.cylinder((0, 0, z - 0.004), (0, 0, z + 0.07), 0.17, rnd=0.018)
        hard.torus((0, 0, z + 0.07), 0.15, 0.011)
        hard.cylinder((0, 0, z + 0.06), (0, 0, z + 0.1), 0.055, rnd=0.01)
        hard.cylinder((0, 0, z + 0.09), (0, 0, z + 0.118), 0.02, rnd=0.005)
        for i in range(8):
            a = i * math.pi / 4 + math.pi / 8
            hard.sphere((math.cos(a) * 0.108, math.sin(a) * 0.108, z + 0.072), 0.016, (1, 1, 0.7))
        hard.torus((0.13, 0.0, z + 0.07), 0.035, 0.008, Matrix.Rotation(math.pi / 2, 3, "X"))
        return sculpt.mesh(VOXEL)

    if rank == "flag":
        base_plate(hard, 0.42, 0.36)
        px, py = -0.13, 0.05
        hard.cylinder((px, py, BASE_TOP - 0.004), (px, py, 0.08), 0.045, rnd=0.012)
        hard.cylinder((px, py, 0.05), (px, py, 0.86), 0.011, rnd=0.003)
        hard.sphere((px, py, 0.875), 0.021)
        W, H = 0.34, 0.22

        def wave(x, zz):
            t = np.clip(x / W, 0, 1)
            return np.sin(t * math.pi * 2.2) * 0.035 * t + np.sin(-zz * 9.0) * 0.006 * t

        sculpt.sheet(V((px, py, 0.84)), W, H, 0.011, wave, HARD)
        return sculpt.mesh(VOXEL)

    pose = POSES[rank]
    s = Soldier(pose["pose"])
    j = s.build(soft, hard)
    for fn in pose.get("props", []):
        fn(hard, j, s)
    for fn in pose.get("soft", []):
        fn(soft, j, s)
    cx = (j["r_ankle"].x + j["l_ankle"].x) / 2
    cy = (j["r_ankle"].y + j["l_ankle"].y) / 2
    w, d = pose.get("base", (0.46, 0.36))
    base_plate(hard, w, d, cx=cx * 0.5, cy=cy * 0.6 - 0.02 + pose.get("base_dy", 0.0))
    return sculpt.mesh(VOXEL)


# ---------------------------------------------------------------- finishing: smooth, seam, bake

def apply_modifiers(obj):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    old = obj.data
    obj.data = me
    bpy.data.meshes.remove(old)


def select_only(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def finish(obj):
    sm = obj.modifiers.new("smooth", "CORRECTIVE_SMOOTH")
    sm.iterations = 2
    sm.smooth_type = "SIMPLE"
    sm.use_only_smooth = True
    apply_modifiers(obj)
    parting_line(obj)
    return obj


def parting_line(obj, width=0.07, height=0.0018):
    """Two-part moulds leave a thin ridge where the halves meet: along the silhouette seen from the front."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    for v in bm.verts:
        n = v.normal
        if abs(n.y) < width and v.co.z > BASE_TOP + 0.012:
            flat = V((n.x, 0, n.z))
            if flat.length > 1e-6:
                v.co += flat.normalized() * height * (1 - abs(n.y) / width)
    bm.to_mesh(obj.data)
    bm.free()


def decimate(src, tris, name):
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = name
    link(obj)
    count = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if count > tris:
        d = obj.modifiers.new("dec", "DECIMATE")
        d.ratio = tris / count
        d.use_collapse_triangulate = True
        apply_modifiers(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def bake_vertex_data(obj):
    """R = ambient occlusion (Cycles bake), G = curvature (convex edges > 0.5), B = 1."""
    me = obj.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    me.color_attributes.active_color = col
    if not me.materials:
        me.materials.append(bpy.data.materials.new("plastic"))
    scene = bpy.context.scene
    scene.cycles.samples = 512
    scene.render.bake.target = "VERTEX_COLORS"
    scene.render.bake.use_selected_to_active = False
    select_only(obj)
    bpy.ops.object.bake(type="AO")
    ao = [d.color[0] for d in col.data]

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    curv = []
    for v in bm.verts:
        acc, n = 0.0, 0
        for e in v.link_edges:
            d = e.other_vert(v).co - v.co
            if d.length > 1e-9:
                acc += -v.normal.dot(d.normalized())
                n += 1
        curv.append(acc / n if n else 0.0)

    def smooth(values, n):
        for _ in range(n):
            values = [
                (values[v.index] + sum(values[e.other_vert(v).index] for e in v.link_edges)) / (1 + len(v.link_edges))
                for v in bm.verts
            ]
        return values

    curv = smooth(curv, 4)
    ao = smooth(ao, 2)
    bm.free()
    for i, d in enumerate(col.data):
        d.color = (ao[i], max(0.0, min(1.0, 0.5 + curv[i] * 6.0)), 1.0, 1.0)


def export(obj, path):
    select_only(obj)
    kwargs = dict(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="NONE",
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs, export_colors=True)


def preview(obj, path, angle=0.0):
    """Studio render of the figure in green plastic, for reviewing the sculpt."""
    scene = bpy.context.scene
    mat = bpy.data.materials.new("preview")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    green = (0.11, 0.24, 0.05, 1)
    bsdf.inputs["Roughness"].default_value = 0.42
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
    ao = nt.nodes.new("ShaderNodeMath")
    ao.operation = "POWER"
    nt.links.new(sep.outputs["Red"], ao.inputs[0])
    ao.inputs[1].default_value = 1.2
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[6].default_value = green
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for k in range(3):
        nt.links.new(ao.outputs[0], comb.inputs[k])
    nt.links.new(comb.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.rotation_euler = (0, 0, math.radians(angle))

    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens = 70
    target = V((0, -0.02, 0.4))
    cam.location = V((0.8, -2.0, 0.95))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    for loc, energy, size in (((1.2, -1.2, 1.8), 90, 1.2), ((-1.6, -0.6, 0.8), 30, 1.5), ((0.2, 1.8, 1.2), 50, 0.8)):
        light = link(bpy.data.objects.new("light", bpy.data.lights.new("light", "AREA")))
        light.data.energy = energy
        light.data.size = size
        light.location = loc
        light.rotation_euler = (V((0, 0, 0.3)) - V(loc)).to_track_quat("-Z", "Y").to_euler()
    floor = bmesh.new()
    bmesh.ops.create_grid(floor, x_segments=1, y_segments=1, size=3)
    me = bpy.data.meshes.new("floor")
    floor.to_mesh(me)
    floor.free()
    fl = link(bpy.data.objects.new("floor", me))
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.55, 0.5, 0.42, 1)
    fl.data.materials.append(fm)
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.8, 0.82, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.35
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.cycles.use_denoising = False
    scene.cycles.samples = 160
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/out", type=Path)
    ap.add_argument("--cache", default="/cache", type=Path)
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--angle", default=0.0, type=float, help="preview turntable angle (degrees)")
    args = ap.parse_args(argv)

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    script_hash = hashlib.sha1(Path(__file__).read_bytes()).hexdigest()[:12]
    only = [r for r in args.only.split(",") if r]

    for rank in RANKS:
        if only and rank not in only:
            continue
        key = f"{script_hash}-{rank}"
        up_to_date = manifest.get(rank, {}).get("hash") == key and (out / f"{rank}.glb").exists()
        if up_to_date and not args.force and not args.preview:
            continue
        print(f"[models] {rank}", flush=True)
        reset()
        fig = finish(build_rank(rank))
        lod0 = decimate(fig, LOD0_TRIS, rank)
        lod1 = decimate(fig, LOD1_TRIS, rank + "-lod1")
        bpy.data.objects.remove(fig)
        for o in (lod0, lod1):
            bake_vertex_data(o)
        export(lod0, out / f"{rank}.glb")
        export(lod1, out / f"{rank}-lod1.glb")
        tris = sum(len(p.vertices) - 2 for p in lod0.data.polygons)
        manifest[rank] = {"hash": key, "file": f"{rank}.glb", "lod1": f"{rank}-lod1.glb", "tris": tris}
        print(f"[models]   {tris} tris", flush=True)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        if args.preview:
            bpy.data.objects.remove(lod1)
            args.cache.mkdir(parents=True, exist_ok=True)
            preview(lod0, args.cache / f"{rank}.png", args.angle)


if __name__ == "__main__":
    main()
