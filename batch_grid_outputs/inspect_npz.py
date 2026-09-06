import numpy as np

d = np.load("001000_grid.npz", allow_pickle=True)

print("Keys:", d.files)
print()
for k in d.files:
    arr = d[k]
    print(f"{k}: shape={arr.shape}, dtype={arr.dtype}")
    try:
        print(arr[:3])
    except Exception as e:
        print("(couldn't preview:", e, ")")
    print()
