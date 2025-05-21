/**
 * Models for Formula 1 real-time data
 */

// Base model class with common functionality
class BaseModel {
  constructor(data = {}) {
    this.update(data);
  }
  
  update(data) {
    if (!data || typeof data !== 'object') return this;
    
    Object.keys(data).forEach(key => {
      if (this.hasOwnProperty(key)) {
        // If this property is another model, call its update method
        if (this[key] instanceof BaseModel) {
          this[key].update(data[key]);
        } else if (Array.isArray(this[key]) && Array.isArray(data[key])) {
          // Handle arrays - replace entire array
          this[key] = [...data[key]];
        } else {
          // Simple property replacement
          this[key] = data[key];
        }
      }
    });
    
    return this;
  }
  
  toJSON() {
    // Convert the model to a plain object
    const result = {};
    
    Object.keys(this).forEach(key => {
      if (this[key] instanceof BaseModel) {
        result[key] = this[key].toJSON();
      } else {
        result[key] = this[key];
      }
    });
    
    return result;
  }
}

// Driver model
class Driver extends BaseModel {
  constructor(data = {}) {
    super();
    this.RacingNumber = '';
    this.BroadcastName = '';
    this.FullName = '';
    this.Tla = '';
    this.TeamName = '';
    this.TeamColor = '';
    this.FirstName = '';
    this.LastName = '';
    this.Reference = '';
    this.HeadshotUrl = '';
    
    this.update(data);
  }
}

// Timing data for a single driver
class DriverTiming extends BaseModel {
  constructor(data = {}) {
    super();
    this.Position = 0;
    this.ClassPosition = 0;
    this.GapToLeader = '';
    this.IntervalToPositionAhead = '';
    this.LastLapTime = '';
    this.BestLapTime = '';
    this.Sectors = {
      '0': { Value: '' },
      '1': { Value: '' },
      '2': { Value: '' }
    };
    this.Speed = {
      '0': 0,
      '1': 0,
      '2': 0
    };
    this.NumberOfLaps = 0;
    this.NumberOfPitStops = 0;
    this.Status = '';
    this.InPit = false;
    
    this.update(data);
  }
}

// Track status model
class TrackStatus extends BaseModel {
  constructor(data = {}) {
    super();
    this.TrackStatus = 'AllClear';
    this.Message = 'All Clear';
    
    this.update(data);
  }
}

// Session info model
class SessionInfo extends BaseModel {
  constructor(data = {}) {
    super();
    this.Meeting = {
      OfficialName: '',
      Location: '',
      Country: {
        Code: '',
        Name: ''
      }
    };
    this.Type = '';
    this.Name = '';
    this.StartDate = '';
    this.EndDate = '';
    this.Status = '';
    
    this.update(data);
  }
}

// Weather data model
class WeatherData extends BaseModel {
  constructor(data = {}) {
    super();
    this.AirTemp = 0;
    this.Humidity = 0;
    this.Pressure = 0;
    this.Rainfall = false;
    this.TrackTemp = 0;
    this.WindDirection = 0;
    this.WindSpeed = 0;
    
    this.update(data);
  }
}

// Car telemetry data model
class CarData extends BaseModel {
  constructor(data = {}) {
    super();
    this.Timestamp = '';
    this.Cars = {};
    
    this.update(data);
  }
  
  updateCar(carNumber, carData) {
    if (!this.Cars[carNumber]) {
      this.Cars[carNumber] = {};
    }
    
    Object.assign(this.Cars[carNumber], carData);
    return this;
  }
}

// Main F1 data model that contains everything
class F1Data extends BaseModel {
  constructor(data = {}) {
    super();
    this.DriverList = {};
    this.TimingData = {};
    this.TrackStatus = new TrackStatus();
    this.SessionInfo = new SessionInfo();
    this.WeatherData = new WeatherData();
    this.CarData = new CarData();
    this.R = {}; // Reference data
    
    this.update(data);
  }
  
  // Override update to handle special cases for nested collections
  update(data) {
    if (!data || typeof data !== 'object') return this;
    
    // Handle driver list updates
    if (data.DriverList) {
      Object.keys(data.DriverList).forEach(driverId => {
        if (!this.DriverList[driverId]) {
          this.DriverList[driverId] = new Driver();
        }
        this.DriverList[driverId].update(data.DriverList[driverId]);
      });
    }
    
    // Handle timing data updates
    if (data.TimingData) {
      Object.keys(data.TimingData).forEach(driverId => {
        if (!this.TimingData[driverId]) {
          this.TimingData[driverId] = new DriverTiming();
        }
        this.TimingData[driverId].update(data.TimingData[driverId]);
      });
    }
    
    // Handle model properties
    if (data.TrackStatus) this.TrackStatus.update(data.TrackStatus);
    if (data.SessionInfo) this.SessionInfo.update(data.SessionInfo);
    if (data.WeatherData) this.WeatherData.update(data.WeatherData);
    if (data.CarData) this.CarData.update(data.CarData);
    
    // Handle reference data (keeping it as a simple object)
    if (data.R) {
      this.R = this.R || {};
      Object.assign(this.R, data.R);
    }
    
    return this;
  }
}

module.exports = {
  F1Data,
  Driver,
  DriverTiming,
  TrackStatus,
  SessionInfo,
  WeatherData,
  CarData
};