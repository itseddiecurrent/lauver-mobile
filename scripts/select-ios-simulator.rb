#!/usr/bin/env ruby

require "json"

payload = JSON.parse($stdin.read)
devices = payload.fetch("devices").values.flatten

available_phones = devices.select do |device|
  device.fetch("isAvailable", true) && device.fetch("name", "").start_with?("iPhone")
end

selected_phone = available_phones.find { |device| device["state"] == "Booted" } || available_phones.first
abort "No available iPhone simulator found" unless selected_phone

puts selected_phone.fetch("udid")
