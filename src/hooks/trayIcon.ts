const BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAA" +
  "GgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEsElEQVRYCe1WW2wUVRj+zpmdvZWF" +
  "AopNpYjEQAgxIBheJMQovqgxIYrRB3kSYuKLRkSjpkwkCkqEaCQxeAOCL20CiheCJKYoCRIpl9LSFbbSy8J2l91td3d253rO8UzC" +
  "xjJu2/UB9aGzD2f++S/fd/7vzD8LTF1THfiPO0D+Dfy5O9si7K7754CH57mZ0YVs+A+RV07vhabxwK0kcM+B83Nz4ZY3R2n4YVEq" +
  "NPFcLkaYAsrDz2Crxj3sW0bgts/jzdeCzT/yabHFdESH098PQhQEnPKRTeqJdu3Gzm+ZBI0HUvv1GU3PKYYJcukC3LIOqqpmxM6u" +
  "Kmxf23kD39+BdUpsZWBleOkqI7TgPl3llZK4fKLQv1czqwn1rLd/0rW6QiPPUtMAyaUhchnQ2EwQo/RlYcdf4F4tenPBdm6Z7tpC" +
  "PH525PQvXfmC2ZO9+5Fz07f8vGve69/NvDm2tvWgpgVspXGrDTWgGBWIgQQYpO5mORu1M9v9WT4CECHbfY+NpgfNxNmI2dkxW3Bl" +
  "kROd81JeaWibu25nxF/Ab3dPf+wpR4muhm1DJIfg5LIg8geztHPkw/WD/ng/AZTih3Ih2O8ooSjcfBqI/wpmFmGFpq8pLli00V9g" +
  "rL1Ea5tWEdFWZjtQ9SJ48orscRAoj1yK5i7sHhtbvf8bAc/RbFj7wOxTlFI4fWcQHB0GGIctgpvnPP/pHdVk/5pSWzY4wRmLhW2B" +
  "X+kFK47IvXMEuKHlv9KK/njPrkkgkThiUbPwBuAywRywvnNSQ11yoM0lpeGVWoXmv/p9k8mCm7kEJ3oJbmpIgkvtS9njRmJ/e62c" +
  "cQl4DrPn258CEAdJIAR3MA6k+iBsE4yEXoit/3ihv2A+GHvNVWNNiilfu74L4JYh+VtuwCi/hY4O1x9ftWt2oOpUTEeDY+sQcmgN" +
  "dIPahmwojVk82FqN8dZZLx9eYpPIBurIsy/PDR++AioIqKG3GYc2nRgb67+fkIDe035REc4eBENSzzRoegBE7owz5enIE+8+UC1m" +
  "KdNaOQ03wDLhDPZCCEBxyoVwZVirxoy3TkjAS6LMel+41jUhFWVX41LfUQjmqpwHtgEr1MYXv1nt8MiTQoIjMyhfuxQ4oSB2eXfx" +
  "2I7L4wFXn09KoNx9OE0cezsRFKwiwbNypntdsIzl4WUtd5o8soURRSGGDlfK5J16WKVBNZveVQWZaJ2UgJfsjKY+I8zqIoEgeC4J" +
  "SCLEKOxWV2xc5vLQQ8QbucMJiHJeai8QsPRtpc492YmAq766CCB50iCus0W2HpwzIDeQCQnjC8vhb3OpN6kUwJLdgGdY+hlrqGtv" +
  "FWCytT4Csord+/VhytyjVL7byA/sEvMfXcNJ9F7qaZ+8CG7IOeNaQqkUW9HfUffHq24CkgMndkUjrqErjQs6bZttZnLek2IWPPO7" +
  "dMuDJ7/11rl9P0y267F+uZ36L55PJGlD02zStLzFjc17nHJ54JInIUypPSE2ccvr+fXeq/VXHGcUT1QgeL37AzUcWyqHLGjmPERJ" +
  "jlxFhbDK+5yeg79NlFvL94//klUq2dQsyj7iqVPH3KHjnNIgISyYt0OVQ7UApp5NdeB/34E/AWZUSfER0kz5AAAAAElFTkSuQmCC";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function trayIconBytes(): Uint8Array {
  const clean = BASE64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = (clean.length * 3) / 4;
  const bytes = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = CHARS.indexOf(clean[i]);
    const b = CHARS.indexOf(clean[i + 1]);
    const c = CHARS.indexOf(clean[i + 2]);
    const d = CHARS.indexOf(clean[i + 3]);
    bytes[p++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes.slice(0, p);
}
