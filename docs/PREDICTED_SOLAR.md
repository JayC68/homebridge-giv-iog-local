# GivHome: Guide to Setting Up Predicted Solar

Predicted Solar estimates how much electricity your panels could generate tomorrow. It combines a weather forecast with your panels’ location, size and direction.

Tomorrow might look like a good day to run several washes or leave more room in your battery for solar charging.

**For now, Predicted Solar provides information only. It does not change inverter settings or control charging.** We continue to learn and improve.

## Step 1 — Enable Predicted Solar

Open the GivHome plugin settings in Homebridge and turn on **Predicted Solar**.

The **Predicted Solar — site** section will appear.

## Step 2 — Enter your location

Enter your postcode or location and two-letter country code.

Examples: **GB** — United Kingdom, **IE** — Ireland, **US** — United States, **AU** — Australia, **NZ** — New Zealand.

For the UK, use your full postcode and **GB**. Elsewhere, if your postal code cannot be found, try your town or city.

## Step 3 — Add your solar panels

Select **Add PV array**. PV means *photovoltaic*: solar panels that turn sunlight into electricity.

An **array** is a group of panels with the same direction and slope. East-facing and west-facing panels should be entered separately.

Your installer’s paperwork should contain the details you need.

### Array name

Choose a recognisable name, such as **Main roof**, **Garage** or **East roof**.

### Capacity (kWp)

**kWp means kilowatt-peak:** the rated power of your panels under standard test conditions.

For ten panels rated at 400 watts each:

**10 × 400 watts = 4,000 watts = 4 kWp**

Enter **4**.

Use the total panel rating for that array, rather than your battery capacity or inverter rating.

### Tilt (degrees)

Tilt means how steeply your panels slope.

| Panel position | Enter |
|---|---:|
| Flat, facing upwards | 0° |
| Halfway between flat and upright | 45° |
| Upright | 90° |

Use the angle of the panels themselves.

### Azimuth / orientation (degrees)

Azimuth means **the direction your panels face**.

Use your installation paperwork or the compass on your iPhone.

| Direction | Enter |
|---|---:|
| North | 0° |
| East | 90° |
| South | 180° |
| West | 270° |

Directions between these work too: south-west is **225°**.

## Step 4 — Add shading periods, if needed

Add times when an array is regularly shaded by a building, tree or dormer.

Use the 24-hour clock and local time at your installation. For example: **08:00–10:00**.

**GivHome counts that array’s output as zero during the whole shading period.** It does not calculate partial shade, so use this carefully.

Leave blank if unnecessary. Review your shading periods as the seasons change.

## Step 5 — Check the advanced settings

Most people can start with:

| Setting | Value |
|---|---:|
| 100% forecast reference (kWh) | 0 |
| Forecast refresh interval (minutes) | 360 |

### 100% forecast reference

This sets the scale for the percentage shown in Apple Home.

At **0**, GivHome automatically uses **4 kWh per installed kWp**.

For example, a **4 kWp** installation gets a **16 kWh** reference. A forecast of **8 kWh** then displays approximately **50%**.

**This percentage compares tomorrow’s forecast with your reference. It is not your battery level or the chance of sunshine.**

The display stays between **1% and 99%**. Changing the reference changes the percentage scale, not the forecast itself.

### Forecast refresh interval

This controls how often GivHome requests an updated forecast.

**360 minutes is six hours**, normally sufficient for tomorrow’s forecast. The minimum is **60 minutes**, limiting requests to Open-Meteo.

## Step 6 — Save and check

Save your settings and follow any Homebridge prompt to apply them.

Look for **Predicted Solar** in Apple Home. GivHome requests a forecast when the feature starts, then refreshes it at your chosen interval.

The Homebridge log shows tomorrow’s forecast in **kWh** alongside the tile percentage.

## A few useful terms

| Term | Meaning |
|---|---|
| **kWp — kilowatt-peak** | The rated size of your solar panels. |
| **kWh — kilowatt-hour** | An amount of electricity. A 1 kW appliance running for one hour uses 1 kWh. |
| **GTI — Global Tilted Irradiance** | The sunlight reaching a surface at your panels’ slope and direction. |

GivHome uses Open-Meteo’s sunlight forecast, your panel details and an allowance for system losses to estimate generation.

**Actual generation will vary.** The forecast estimates electricity from your panels, before household use, battery charging or export.

## Troubleshooting

| Problem | What to check |
|---|---|
| No accessory | Enable Predicted Solar, save and apply your settings. |
| No forecast | Check your internet connection and Homebridge log. |
| Location not found | Check the country code; try a town or city outside the UK. |
| Forecast seems wrong | Check capacity, tilt, direction and shading periods. |
| Forecast dropped after adding shading | Shading periods count that array’s output as zero. |
| Percentage seems wrong | Check the forecast reference. The display is limited to 1–99%. |
