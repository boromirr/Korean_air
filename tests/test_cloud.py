import os
import unittest
from unittest.mock import patch
from cloud.serve import nginx_config
from local_app import Handler


class CloudBoundaryTests(unittest.TestCase):
    def test_rejects_unsafe_config(self):
        for token, origin, port in [('short', 'https://owner.example', 8080), ('a'*40, 'http://owner.example', 8080), ('a'*40, 'https://owner.example/other', 8080), ('a'*40, 'https://owner.example', 80)]:
            with self.assertRaises(ValueError):
                nginx_config(token, origin, port)

    def test_loopback_ports_stay_private(self):
        config = nginx_config('a'*40, 'https://owner.example', 8080)
        self.assertEqual(config.count('if ($gateway_allowed = 0)'), 2)
        self.assertIn('proxy_pass http://127.0.0.1:6080/', config)
        self.assertIn('proxy_pass http://127.0.0.1:8765', config)

    def test_cloud_ui_only_in_cloud_mode(self):
        handler = Handler.__new__(Handler)
        with patch.dict(os.environ, {'AWARD_CLOUD_MODE': '0'}):
            local = handler.web_asset('index.html').decode()
        with patch.dict(os.environ, {'AWARD_CLOUD_MODE': '1'}):
            cloud = handler.web_asset('index.html').decode()
        self.assertNotIn('src="/cloud-ui.js"', local)
        self.assertIn('src="/cloud-ui.js"', cloud)
        self.assertNotIn('내 컴퓨터에서 쓰는 개인용 조회', cloud)
