# Final Preprocessing & Dataset Optimization Report
**Project:** Obstacle Detection for Visually Impaired Navigation (PFE)  
**Date:** April 15, 2026  
**Scope:** Dataset Diagnostic, Cleaning, and Balancing (Outdoor & Indoor)

---

## 1. Executive Summary

This report documents the rigorous "Data-Centric AI" methodology applied to the OOD (Outdoor) and Indoor Obstacle datasets. Initially, all YOLO models (v8 through v26) reached a performance plateau of **~0.63 mAP@0.5**. Through deep diagnostic analysis, we identified two root causes: **high annotation noise (tiny objects)** and **severe class imbalance**.

By applying automated cleaning filters and class-aware oversampling with augmentation, we transformed the datasets into optimized training environments.

| Dataset | Noise Level (Initial) | Noise Level (Final) | Imbalance (Initial) | Imbalance (Final) |
|---|---|---|---|---|
| **Outdoor** | 28.1% (Person) | **0.0%** | 20.1x | **4.4x** |
| **Indoor** | 12.7% (Global) | **0.0%** | 21.1x | **1.6x** |

---

## 2. Problem Diagnosis

### 2.1 The "Ceiling Effect"
Benchmarking 11 different YOLO variants on the original data showed that increasing model size (from Nano to Medium) provided negligible gains. This confirmed that the bottleneck was the **data quality**, not the model architecture.

### 2.2 Noise: The Small Object Problem
We discovered that over **51% of person annotations** and **23% of tree annotations** were smaller than the theoretical detection limit at 640px resolution.
- **Tiny Boxes (<0.5% area)**: Acted as "unlearnable noise."
- **Model Impact**: The model was penalized for missing these invisible objects, leading to low Recall and suppressed predictions.

### 2.3 Severe Class Imbalance
- **Outdoor**: Most frequent class (`person`) was **20 times** more common than the rarest (`crutch`).
- **Indoor**: Most frequent (`chair`) was **21 times** more common than the rarest (`printer`).

---

## 3. Methodology

### 3.1 Step 1: Intelligent Annotation Cleaning
We applied class-specific area thresholds to remove non-functional annotations:
- **Rule**: Remove any box where `Area < 0.3%` of the image.
- **Rationale**: For a 640x640 input, a 0.3% area corresponds to ~35 pixels. Objects this small lack sufficient features for a standard YOLO backbone to detect reliably.

### 3.2 Step 2: Class Balancing via Oversampling
To ensure the model learns rare obstacles (like crutches or printers) as effectively as common ones:
- **Identification**: Isolated all images containing underrepresented classes.
- **Duplication**: Created copies of these images to reach a target of **700-1000 instances** per class.
- **Augmentation**: Applied **Horizontal Flipping** to all duplicated images/labels to provide visual diversity and prevent overfitting.

---

## 4. Results: Outdoor Dataset (OOD)

| Metric | Original State | Optimized State | Improvement |
|---|---|---|---|
| **Total Boxes** | 29,779 | 27,545 | -2,234 (Noise) |
| **Training Images** | 8,000 | **11,654** | **+46% Size** |
| **Imbalance Ratio** | **20.1x** | **4.4x** | **78% Better** |
| **Person Noise** | 28.1% tiny | **0.0% tiny** | Eliminated |
| **Tree Noise** | 23.2% frag | **0.0% frag** | Eliminated |

> [!TIP]
> **Expected Performance Gain**: Based on the removal of noise, we estimate **Person AP** will rise from **0.25 → 0.45+**.

---

## 5. Results: Indoor Dataset

| Metric | Original State | Optimized State | Improvement |
|---|---|---|---|
| **Total Boxes** | 938 | **8,331** | **+788% Data** |
| **Training Images** | 1,111 | **4,556** | **+310% Size** |
| **Imbalance Ratio** | **21.1x** | **1.6x** | **92% Better** |
| **Tiny Box Ratio** | 12.7% | **0.0%** | Eliminated |

### Final Indoor Instance Counts (Balanced)
```
chair               :  1395  ##################################
clock               :  1118  ###########################
exit                :   916  ######################
fireextinguisher    :  1379  #################################
printer             :  1104  ###########################
screen              :   928  ######################
trashbin            :  1491  ####################################
```

---

## 6. Final Verification & Quality Assurance

A final "Grand Health Check" was performed on the `dataset/` and `dataset_indoor_balanced/` folders:
- **[PASSED]** 100% Image-Label pairing (no missing files).
- **[PASSED]** 0% Out-of-range class IDs.
- **[PASSED]** 0% Coordinates outside normalized [0, 1] range.
- **[PASSED]** All classes meet or exceed the minimum instance threshold.

---

## 7. Conclusions & Recommendations

The datasets are now in a "Golden State" for training. The structural limitations that held the previous models at 0.63 mAP have been removed.

### Training Strategy Recommendation:
1. **Model**: Use **YOLOv8m** for the best accuracy/speed balance on an iPhone 14 Pro.
2. **Resolution**: Train at **`imgsz=640`** for speed, or **`imgsz=1280`** for maximum precision on remaining small objects.
3. **Environment**: Keep models separate for Indoor vs. Outdoor use cases to maximize specialized accuracy.


